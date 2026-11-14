/**
 * Coordinator tool gating for First Mate.
 *
 * While coordinator mode is effective, only the four inspection tools and tools
 * registered by the approved orchestration packages stay available. Other
 * active tools are removed from the model-facing set, and every call, including
 * a nested call issued through `ctx.executeTool()`, is checked again at Pi's
 * `tool_call` boundary.
 *
 * This is tool-call enforcement, not an OS sandbox. An allowed tool can still
 * perform whatever its own implementation exposes, so permission, trust and
 * authorization boundaries remain in force.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, SourceInfo } from "@earendil-works/pi-coding-agent";

const INSPECTION_TOOLS = new Set(["read", "grep", "find", "ls"]);

/** Installed packages whose tools stay available to a coordinator. */
export const APPROVED_PACKAGES = new Set([
	"@abhishek944/pi-tasks",
	"@abhishek944/pi-loop-monitor",
	"@abhishek944/pi-decisions",
	"@abhishek944/pi-herdr",
	"@abhishek944/pi-schedulers",
]);

const COORDINATOR_ONLY_PACKAGES = new Set(["@abhishek944/pi-schedulers"]);

export const COORDINATOR_TOOLS_DESCRIPTION =
	"read, grep, find, ls and installed pi-tasks, pi-loop-monitor, pi-decisions, pi-herdr and coordinator-only pi-schedulers tools";

type ToolHost = Pick<ExtensionAPI, "getActiveTools" | "getAllTools" | "setActiveTools">;

export interface ToolGate {
	/** Actual installed registrations that must never enter the ordinary-tool baseline. */
	coordinatorOnlyNames(): Set<string>;
	/** Whether coordinator mode may call this tool. */
	permits(toolName: string): boolean;
	/** Hide every active tool outside the allowlist and return the hidden names. */
	hide(): string[];
	/** Actionable explanation for a rejected direct or nested call. */
	reason(toolName: string): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceBaseDir(sourceInfo: SourceInfo): string | undefined {
	if (sourceInfo.baseDir !== undefined) return sourceInfo.baseDir;
	if (sourceInfo.path.startsWith("builtin:") || sourceInfo.path.startsWith("<")) return undefined;
	return dirname(sourceInfo.path);
}

export function createToolGate(pi: ToolHost): ToolGate {
	const sourcePackages = new Map<string, string | null>();

	// Package identity comes from the registration's installed package root, not
	// from a tool name list or self-declared annotations. The extension entry can
	// live in `dist/` (explicit extension paths) or the package root (discovered
	// packages), so walk to the nearest manifest. A missing or unreadable manifest
	// stays unapproved so new or unexpected tools fail closed.
	function sourcePackage(sourceInfo: SourceInfo): string | null {
		const baseDir = sourceBaseDir(sourceInfo);
		if (baseDir === undefined) return null;
		const cached = sourcePackages.get(baseDir);
		if (cached !== undefined) return cached;

		let packageName: string | null = null;
		let directory = baseDir;
		while (true) {
			try {
				const manifest: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
				packageName = isRecord(manifest) && typeof manifest.name === "string" ? manifest.name : null;
				break;
			} catch {
				const parent = dirname(directory);
				if (parent === directory) break;
				directory = parent;
			}
		}
		sourcePackages.set(baseDir, packageName);
		return packageName;
	}

	// Rebuild from the live registry so tools registered after session start are
	// classified from their actual installation instead of a stale snapshot.
	function allowedNames(): Set<string> {
		const allowed = new Set(INSPECTION_TOOLS);
		for (const tool of pi.getAllTools()) {
			if (APPROVED_PACKAGES.has(sourcePackage(tool.sourceInfo) ?? "")) allowed.add(tool.name);
		}
		return allowed;
	}

	return {
		coordinatorOnlyNames() {
			return new Set(pi.getAllTools()
				.filter((tool) => COORDINATOR_ONLY_PACKAGES.has(sourcePackage(tool.sourceInfo) ?? ""))
				.map((tool) => tool.name));
		},

		permits(toolName) {
			if (INSPECTION_TOOLS.has(toolName)) return true;
			try {
				return allowedNames().has(toolName);
			} catch {
				return false;
			}
		},

		hide() {
			const allowed = allowedNames();
			const active = pi.getActiveTools();
			const kept = active.filter((name) => allowed.has(name));
			const hidden = active.filter((name) => !allowed.has(name));
			if (hidden.length > 0) pi.setActiveTools(kept);
			return hidden;
		},

		reason(toolName) {
			return `First Mate coordinator mode blocks ${JSON.stringify(toolName)}. Only ${COORDINATOR_TOOLS_DESCRIPTION} are available in this coordinator session, including for nested tool calls. This is an intentional coordinator restriction, not a missing permission: do not ask to enable the tool. Check that an installed delegation backend is ready and delegate the work through its orchestration tools, or run /firstmate off before doing it locally.`;
		},
	};
}
