/**
 * First Mate - configurable coordinator mode for primary Pi sessions.
 *
 * The mode keeps conversation, decisions and quick inspection in the main
 * session, and delegates project execution to workers through an available
 * installed orchestration backend. The behavioral policy lives in
 * `skills/firstmate/SKILL.md`; this extension only owns configuration, the
 * session toggle, worker suppression, status and per-run prompt guidance.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type ConfiguredDefault, readConfiguredDefault } from "./config.js";
import { clearBannerState, ensureHerdrBanner, herdrAppHome, writeBannerState } from "./herdr-banner.js";
import { COORDINATOR_TOOLS_DESCRIPTION, createToolGate } from "./tool-gate.js";
import { classifyCoreWorker, type WorkerClassification } from "./worker.js";

const COMMAND_NAME = "firstmate";
const ENTRY_TYPE = "pi-firstmate.mode";
const TOOL_ENTRY_TYPE = "pi-firstmate.tools";
const SECTION_KEY = "first_mate";
const STATUS_KEY = "firstmate";
const POLICY_DISPLAY_PATH = "skills/firstmate/SKILL.md";
const POLICY_URL = new URL("../skills/firstmate/SKILL.md", import.meta.url);
const BANNER_ASSETS = new URL("../herdr/firstmate-banner/", import.meta.url);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const ON_GUIDELINE =
	"First Mate coordinator mode is active for this session. Follow the <first_mate> section: keep conversation, decisions, quick inspection and coordination local, and delegate project execution to workers through an available, authorized orchestration backend following its actual instructions. If delegation is unavailable, report the blocker instead of silently doing substantial work locally.";
const OFF_GUIDELINE =
	"First Mate coordinator mode is off. Supersede any earlier First Mate coordinator guidance in this session and resume ordinary project and host instructions for project work.";

const USAGE =
	"Usage: /firstmate on | off | default | status. With no argument, shows status.";

interface ModeResolution {
	effective: boolean;
	worker: WorkerClassification;
	suppressed: boolean;
	uncertain: boolean;
}

type BannerStatus =
	| { kind: "off"; detail: string }
	| { kind: "ready"; detail: string }
	| { kind: "unavailable"; detail: string };

function stripFrontmatter(markdown: string): string {
	const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
	return match ? markdown.slice(match[0].length) : markdown;
}

function report(
	ctx: ExtensionContext | ExtensionCommandContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	// Non-interactive modes have no dialog UI. Use stderr so print/json output
	// on stdout is never corrupted by extension diagnostics.
	console.error(message);
}

function errorText(error: unknown): string {
	const line = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0]?.trim();
	return line === undefined || line === "" ? "unknown error" : line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a persisted tool-name list; `null` is an explicit cleared marker. */
function readToolNames(value: unknown): string[] | null | undefined {
	if (value === null) return null;
	if (!Array.isArray(value)) return undefined;
	const names: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") return undefined;
		if (!names.includes(item)) names.push(item);
	}
	return names;
}

function toolSetKey(tools: string[] | null): string | null {
	return tools === null ? null : JSON.stringify([...tools].sort());
}

export default function firstMateExtension(pi: ExtensionAPI): void {
	pi.registerFlag("firstmate-worker", {
		type: "boolean",
		default: false,
		description: "Mark this Pi process as a worker; always suppress First Mate coordinator guidance",
	});
	let config: ConfiguredDefault = { kind: "valid", enabled: false, banner: true };
	let override: boolean | null = null;
	let banner: BannerStatus | undefined;
	let guidanceEvidence = false;
	let worker: WorkerClassification | undefined;
	let policyText: string | undefined;
	let policyError: string | undefined;
	const toolGate = createToolGate(pi);
	let savedActiveTools: string[] | null = null;
	let savedBaselineKey: string | null = null;
	let offRequestPrepared = false;

	function refreshConfig(): void {
		const settings: unknown = pi.getSettings();
		config = readConfiguredDefault(settings);
	}

	function refreshSessionState(ctx: ExtensionContext | ExtensionCommandContext): void {
		const sessionId = ctx.sessionManager.getSessionId();
		let restored: boolean | null = null;
		let restoredTools: string[] | null = null;
		let sawGuidanceSection = false;

		// Session-level state: scan every entry, not only the active branch, so
		// tree navigation inside one session does not silently undo the toggle.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "system") {
				const sections = entry.message.sections;
				const value = sections?.[SECTION_KEY];
				if (value !== undefined && value !== null) sawGuidanceSection = true;
			}
			if (entry.type !== "custom") continue;
			if (entry.customType === TOOL_ENTRY_TYPE) {
				if (!isRecord(entry.data) || entry.data.sessionId !== sessionId) continue;
				const tools = readToolNames(entry.data.tools);
				if (tools !== undefined) restoredTools = tools;
				continue;
			}
			if (entry.customType !== ENTRY_TYPE) continue;
			if (!isRecord(entry.data)) continue;
			const data = entry.data;
			if (data.sessionId !== sessionId) continue;
			if (data.enabled !== true && data.enabled !== false && data.enabled !== null) continue;
			restored = data.enabled;
		}

		override = restored;
		savedActiveTools = restoredTools;
		savedBaselineKey = toolSetKey(restoredTools);
		// A persisted First Mate prompt section is direct evidence that earlier
		// coordinator guidance exists in this session, including after reload.
		guidanceEvidence = sawGuidanceSection;
	}

	function loadPolicy(): string | undefined {
		if (policyText !== undefined) return policyText;
		try {
			const text = stripFrontmatter(readFileSync(fileURLToPath(POLICY_URL), "utf8")).trim();
			if (text === "") throw new Error("the skill file is empty");
			policyText = text;
			policyError = undefined;
			return policyText;
		} catch (error) {
			policyError = error instanceof Error ? error.message : String(error);
			return undefined;
		}
	}

	function resolveMode(): ModeResolution {
		const configuredDefault = config.kind === "valid" ? config.enabled : false;
		const requested = override !== null ? override : configuredDefault;
		const classification: WorkerClassification = worker ?? {
			kind: "unknown",
			terminalId: "",
			message: "the Core worker check has not completed",
		};

		let effective = requested;
		let uncertain = false;
		if (classification.kind === "worker" || classification.kind === "explicit-worker") {
			effective = false;
		} else if (classification.kind === "unknown" && override === null && requested) {
			// Never apply the configured default to a possible worker.
			effective = false;
			uncertain = true;
		}

		return {
			effective,
			worker: classification,
			suppressed: (classification.kind === "worker" || classification.kind === "explicit-worker") && requested,
			uncertain,
		};
	}

	/**
	 * Restrict the model-facing tools while coordinator mode is effective, and
	 * restore the activation state from before the first restriction when it turns
	 * off. The baseline is persisted in existing session state so a resumed process
	 * can restore the exact pre-gate set before a model request records it again.
	 */
	function saveToolBaseline(ctx: ExtensionContext | ExtensionCommandContext, tools: string[] | null): void {
		const key = toolSetKey(tools);
		if (key === savedBaselineKey) return;
		if (tools === null && savedBaselineKey === null) return;
		pi.appendEntry(TOOL_ENTRY_TYPE, { sessionId: ctx.sessionManager.getSessionId(), tools });
		savedBaselineKey = key;
	}

	function clearRestoredToolBaseline(ctx: ExtensionContext | ExtensionCommandContext): void {
		if (resolveMode().effective || savedActiveTools === null) return;
		const active = new Set(pi.getActiveTools());
		if (!savedActiveTools.every((name) => active.has(name))) return;
		savedActiveTools = null;
		saveToolBaseline(ctx, null);
	}

	function syncToolGate(ctx: ExtensionContext | ExtensionCommandContext): void {
		if (resolveMode().effective) {
			offRequestPrepared = false;
			const active = pi.getActiveTools();
			// Record everything that is actually active before hiding it. This
			// includes direct tools registered and auto-activated during the run,
			// without adding tools that were never active.
			savedActiveTools = savedActiveTools === null ? active : [...new Set([...savedActiveTools, ...active])];
			saveToolBaseline(ctx, savedActiveTools);
			toolGate.hide();
			return;
		}
		if (savedActiveTools === null) return;

		const active = pi.getActiveTools();
		const activeSet = new Set(active);
		if (savedActiveTools.some((name) => !activeSet.has(name))) {
			pi.setActiveTools([...new Set([...savedActiveTools, ...active])]);
		}
	}

	async function classifyWorker(): Promise<WorkerClassification> {
		// An explicit process marker must not depend on hc being installed or live.
		if (pi.getFlag("firstmate-worker") === true) return { kind: "explicit-worker" };
		return classifyCoreWorker(pi);
	}

	async function ensureWorkerKnown(): Promise<void> {
		if (worker !== undefined && worker.kind !== "unknown") return;
		worker = await classifyWorker();
	}

	function saveOverride(enabled: boolean | null, ctx: ExtensionCommandContext): void {
		const sessionId = ctx.sessionManager.getSessionId();
		pi.appendEntry(ENTRY_TYPE, { sessionId, enabled });
		override = enabled;
	}

	function syncIndicator(ctx: ExtensionContext | ExtensionCommandContext): void {
		ctx.ui.setStatus(STATUS_KEY, resolveMode().effective ? "First Mate" : undefined);
	}

	/**
	 * Publish the effective mode that the optional Herdr banner reads, and make
	 * the mod/layout ready in a verified primary Core session. Workers, non-Core
	 * sessions and an inconclusive Core check clear their own state instead of
	 * advertising coordinator mode. Banner problems never affect First Mate.
	 */
	function syncBanner(ctx: ExtensionContext | ExtensionCommandContext): void {
		const sessionId = ctx.sessionManager.getSessionId();
		const mode = resolveMode();
		const clearOwnState = (): void => {
			const terminal = "terminalId" in mode.worker ? mode.worker.terminalId : process.env.HC_TERMINAL_ID?.trim();
			try {
				clearBannerState(herdrAppHome(), sessionId, terminal);
			} catch {
				// Banner cleanup must never disturb mode.
			}
		};
		if (config.kind === "invalid") {
			clearOwnState();
			banner = { kind: "off", detail: "settings are invalid" };
			return;
		}
		if (config.bannerProblem !== undefined) {
			clearOwnState();
			banner = { kind: "off", detail: `invalid setting: ${config.bannerProblem}` };
			return;
		}
		if (!config.banner) {
			clearOwnState();
			banner = { kind: "off", detail: 'disabled by "pi-firstmate.banner"' };
			return;
		}
		if (!SESSION_ID.test(sessionId)) {
			banner = { kind: "unavailable", detail: "the Pi session ID cannot identify a state file" };
			return;
		}
		switch (mode.worker.kind) {
			case "explicit-worker":
			case "worker":
				clearOwnState();
				banner = { kind: "off", detail: "worker sessions never show it" };
				return;
			case "not-core":
				clearOwnState();
				banner = { kind: "off", detail: "this Pi process is not in a Herdr Core terminal" };
				return;
			case "unknown":
				clearOwnState();
				banner = { kind: "off", detail: `the Core worker check failed (${mode.worker.message})` };
				return;
			case "primary": {
				const appHome = herdrAppHome();
				const setup = ensureHerdrBanner(appHome, BANNER_ASSETS);
				try {
					writeBannerState(appHome, {
						sessionId,
						terminal: mode.worker.terminalId,
						effective: mode.effective,
					});
				} catch (error) {
					banner = { kind: "unavailable", detail: `the session state could not be written: ${errorText(error)}` };
					return;
				}
				banner =
					setup.state === "unavailable"
						? { kind: "unavailable", detail: setup.detail }
						: {
								kind: "ready",
								detail: `${setup.detail}, ${mode.effective ? "shown in this session's tab" : "collapsed while this session is off"}`,
							};
				return;
			}
		}
	}

	function bannerText(): string {
		if (banner === undefined) return "not checked yet";
		return banner.kind === "ready" ? banner.detail : `${banner.kind}: ${banner.detail}`;
	}

	function configuredDefaultText(): string {
		if (config.kind === "invalid") return `off (invalid settings: ${config.message})`;
		return config.enabled
			? `on (settings "pi-firstmate.enabled")`
			: `off (settings "pi-firstmate.enabled" or omitted)`;
	}

	function workerText(classification: WorkerClassification): string {
		switch (classification.kind) {
			case "explicit-worker":
				return "explicit worker (--firstmate-worker); coordinator guidance is never applied in workers";
			case "not-core":
				return "not a Core process";
			case "primary":
				return `primary Core session (${classification.terminalId})`;
			case "worker": {
				const parent = classification.parent ? `, parent=${classification.parent}` : "";
				return `verified Core worker pi.task=${classification.task}, pi.session=${classification.parentSessionId}${parent}; coordinator guidance is never applied in workers`;
			}
			case "unknown":
				return `unknown: ${classification.message}`;
		}
	}

	function statusText(): { text: string; level: "info" | "warning" | "error" } {
		const mode = resolveMode();
		const state = mode.suppressed
			? "off (worker suppression)"
			: mode.uncertain
				? "off (worker check failed)"
				: mode.effective
					? "on"
					: "off";
		const policy = loadPolicy();
		const guidance = mode.effective
			? policy
				? `injected from ${POLICY_DISPLAY_PATH}`
				: `not injected: ${policyError ?? "the skill policy is unavailable"}`
			: "not injected";

		const lines = [
			`First Mate: ${state}`,
			`Configured default: ${configuredDefaultText()}`,
			`Session override: ${override === null ? "none" : override ? "on" : "off"}`,
			`Worker: ${workerText(mode.worker)}`,
			`Tools: ${mode.effective ? `restricted to ${COORDINATOR_TOOLS_DESCRIPTION}` : "normal"}`,
			`Banner: ${bannerText()}`,
			`Guidance: ${guidance}`,
		];

		const bannerProblem = config.kind === "valid" && config.bannerProblem !== undefined;
		const level =
			config.kind === "invalid"
				? "error"
				: bannerProblem || mode.suppressed || mode.uncertain || (mode.effective && !policy)
					? "warning"
					: "info";
		return { text: lines.join("\n"), level };
	}

	pi.registerCommand(COMMAND_NAME, {
		description: "Turn First Mate coordinator mode on or off, or report its status",
		getArgumentCompletions: (prefix) => {
			const trimmed = prefix.trim();
			if (trimmed.includes(" ")) return null;
			const matches = ["on", "off", "status", "default"].filter((value) => value.startsWith(trimmed));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			refreshConfig();
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const action = parts[0]?.toLowerCase();

			if (action === undefined || action === "status") {
				if (parts.length > 1) {
					report(ctx, USAGE, "warning");
					return;
				}
				await ensureWorkerKnown();
				syncToolGate(ctx);
				syncBanner(ctx);
				const status = statusText();
				report(ctx, status.text, status.level);
				return;
			}

			if (parts.length > 1 || (action !== "on" && action !== "off" && action !== "default")) {
				report(ctx, USAGE, "warning");
				return;
			}

			await ensureWorkerKnown();

			if (action === "on") {
				saveOverride(true, ctx);
				syncToolGate(ctx);
				syncIndicator(ctx);
				syncBanner(ctx);
				const mode = resolveMode();
				if (mode.worker.kind === "explicit-worker") {
					report(
						ctx,
						"First Mate override saved, but coordinator guidance is suppressed by --firstmate-worker. Workers follow their assignment and ordinary project and host instructions.",
						"warning",
					);
				} else if (mode.worker.kind === "worker") {
					report(
						ctx,
						`First Mate override saved, but coordinator guidance is suppressed in this Core worker session (pi.task=${mode.worker.task}). Workers follow their assignment and ordinary project and host instructions.`,
						"warning",
					);
				} else if (mode.worker.kind === "unknown") {
					report(
						ctx,
						`First Mate is on by explicit session override. The Core worker check failed (${mode.worker.message}), so the configured default is not applied to a possible worker; your explicit override still applies.`,
						"warning",
					);
				} else if (!loadPolicy()) {
					report(
						ctx,
						`First Mate is on for this session, but its policy could not be read from ${POLICY_DISPLAY_PATH}: ${policyError}. No coordinator guidance is injected.`,
						"error",
					);
				} else {
					report(
						ctx,
						"First Mate is on for this session. Conversation, decisions and quick inspection stay local; project execution goes to workers.",
						"info",
					);
				}
				return;
			}

			if (action === "off") {
				saveOverride(false, ctx);
				syncToolGate(ctx);
				offRequestPrepared = false;
				syncIndicator(ctx);
				syncBanner(ctx);
				report(
					ctx,
					"First Mate is off for this session. Earlier coordinator guidance is superseded; ordinary project and host instructions apply.",
					"info",
				);
				return;
			}

			saveOverride(null, ctx);
			syncToolGate(ctx);
			syncIndicator(ctx);
			syncBanner(ctx);
			const mode = resolveMode();
			const state = mode.suppressed
				? "off because this is a verified worker session"
				: mode.uncertain
					? "off because the Core worker check failed"
					: mode.effective
						? "on"
						: "off";
			report(ctx, `First Mate now follows the configured default: ${state}.`, mode.suppressed || mode.uncertain ? "warning" : "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		refreshConfig();
		refreshSessionState(ctx);
		worker = await classifyWorker();
		loadPolicy();

		const mode = resolveMode();
		syncIndicator(ctx);
		offRequestPrepared = false;
		syncToolGate(ctx);
		syncBanner(ctx);

		if (config.kind === "invalid") {
			report(
				ctx,
				`First Mate settings problem: ${config.message}. The configured default is treated as off; fix settings.json or use /firstmate on explicitly.`,
				"error",
			);
		}
		if (config.kind === "valid" && config.bannerProblem !== undefined) {
			report(
				ctx,
				`First Mate banner setting problem: ${config.bannerProblem}. The banner is off; coordinator mode is unaffected.`,
				"warning",
			);
		}
		if (mode.uncertain && mode.worker.kind === "unknown") {
			report(
				ctx,
				`First Mate could not verify whether this Core session is a task worker (${mode.worker.message}). Coordinator guidance from the configured default is not applied; use /firstmate on if this is a coordinator session.`,
				"warning",
			);
		}
		if (mode.effective && !loadPolicy()) {
			report(
				ctx,
				`First Mate is on, but its policy could not be read from ${POLICY_DISPLAY_PATH}: ${policyError}. No coordinator guidance will be injected.`,
				"error",
			);
		}
	});

	pi.on("before_agent_start", (event, ctx) => {
		syncToolGate(ctx);
		const mode = resolveMode();
		offRequestPrepared = !mode.effective && savedActiveTools !== null;
		const options = event.systemPromptOptions;

		if (mode.effective) {
			const policy = loadPolicy();
			if (policy !== undefined) {
				options.sections[SECTION_KEY] = policy;
				guidanceEvidence = true;
				if (!options.promptGuidelines.includes(ON_GUIDELINE)) {
					options.promptGuidelines.push(ON_GUIDELINE);
				}
			} else {
				delete options.sections[SECTION_KEY];
			}
			return;
		}

		delete options.sections[SECTION_KEY];
		if (guidanceEvidence && !options.promptGuidelines.includes(OFF_GUIDELINE)) {
			options.promptGuidelines.push(OFF_GUIDELINE);
		}
	});

	// `turn_end` runs after a turn's tool calls and before Pi snapshots the next
	// request's tool declarations in `prepareNextTurnWithContext`. Hiding here
	// covers direct tools registered during a multi-turn run, such as a slow MCP
	// connection that registers after `before_agent_start`.
	pi.on("turn_end", (event, ctx) => {
		syncToolGate(ctx);
		const completed =
			event.message.role === "assistant" &&
			event.message.stopReason !== "error" &&
			event.message.stopReason !== "aborted";
		if (!resolveMode().effective && offRequestPrepared && completed) {
			clearRestoredToolBaseline(ctx);
			offRequestPrepared = false;
		}
	});

	pi.on("tool_call", (event) => {
		if (!resolveMode().effective) return undefined;
		if (toolGate.permits(event.toolName)) return undefined;
		return { block: true, reason: toolGate.reason(event.toolName) };
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (savedActiveTools !== null) {
			try {
				pi.setActiveTools([...new Set([...savedActiveTools, ...pi.getActiveTools()])]);
			} catch {
				// Shutdown cleanup is best-effort.
			}
			savedActiveTools = null;
			savedBaselineKey = null;
		}
		offRequestPrepared = false;
		override = null;
		guidanceEvidence = false;
		worker = undefined;
		try {
			clearBannerState(herdrAppHome(), ctx.sessionManager.getSessionId());
		} catch {
			// Shutdown is best-effort; a stale file is hidden by the mod's live check.
		}
		banner = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
