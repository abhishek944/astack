/**
 * Optional native Herdr banner for First Mate.
 *
 * A personal Herdr layout gets one extra block above the block that contains
 * the shown tab. That block loads `mods/firstmate-banner`, which reads the
 * small per-session state files written here and shows the strip only for the
 * active tab's live First Mate session.
 *
 * Everything in this module is best-effort. First Mate's mode, guidance and
 * status keep working when Herdr is absent, the shown layout is shipped, or a
 * file cannot be written.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const BANNER_MOD = "firstmate-banner";
export const BANNER_NODE_ID = "firstmate-banner";

const SHIPPED_LAYOUTS = new Set(["main", "terminals", "win98"]);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TERMINAL_ID = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?t[0-9a-z]+$/;
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ASSET_NAMES = ["main.js", "mod.json", "README.md"] as const;

type Json = Record<string, unknown>;

export interface BannerSetup {
	/** installed: this call wrote something. present: everything already matched. */
	state: "installed" | "present" | "unavailable";
	detail: string;
}

export interface BannerState {
	sessionId: string;
	terminal: string;
	effective: boolean;
}

function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
	const line = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0]?.trim();
	return line === undefined || line === "" ? "unknown error" : line;
}

/**
 * The Herdr app home, matching the app's own lookup: `HERDR_APP_HOME`, else
 * `XDG_CONFIG_HOME/herdr-app`, else `~/.config/herdr-app`.
 */
export function herdrAppHome(env: NodeJS.ProcessEnv = process.env): string {
	const custom = env.HERDR_APP_HOME?.trim();
	if (custom !== undefined && custom !== "") return resolve(custom);
	const config = env.XDG_CONFIG_HOME?.trim();
	const base = config !== undefined && config !== "" && isAbsolute(config) ? config : join(homedir(), ".config");
	return join(base, "herdr-app");
}

function bannerDataDir(appHome: string): string {
	return join(appHome, "data", BANNER_MOD);
}

function writeAtomic(path: string, data: string | Buffer): void {
	const temporary = `${path}.firstmate-${process.pid}-${Date.now()}.tmp`;
	writeFileSync(temporary, data);
	try {
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

/** Keep the previous installed copy next to the recovery notes, not in the live mod folder. */
function backup(path: string, name: string, backupDir: string): void {
	mkdirSync(backupDir, { recursive: true });
	copyFileSync(path, join(backupDir, `${Date.now()}-${name}`));
}

/** Install or update only the files this package owns; never duplicate identical content. */
function installAssets(appHome: string, assets: Map<string, Buffer>, backupDir: string): void {
	const directory = join(appHome, "mods", BANNER_MOD);
	mkdirSync(directory, { recursive: true });
	for (const [name, data] of assets) {
		const target = join(directory, name);
		if (existsSync(target) && readFileSync(target).equals(data)) continue;
		if (existsSync(target)) backup(target, name, backupDir);
		writeAtomic(target, data);
	}
}

/** The layout the running window shows, from the app's shared state. */
function shownLayout(appHome: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(appHome, "shared.json"), "utf8"));
		if (!isRecord(parsed) || typeof parsed.layout !== "string" || !LAYOUT_NAME.test(parsed.layout)) return undefined;
		return parsed.layout;
	} catch {
		return undefined;
	}
}

function findNode(node: unknown, id: string): Json | undefined {
	if (!isRecord(node)) return undefined;
	if (node.id === id) return node;
	for (const child of Array.isArray(node.children) ? node.children : []) {
		const found = findNode(child, id);
		if (found !== undefined) return found;
	}
	return undefined;
}

/** The root-to-block path of the layout node that shows the active tab. */
function pathToActiveTab(node: unknown, trail: Json[] = []): Json[] | undefined {
	if (!isRecord(node)) return undefined;
	const path = [...trail, node];
	if (isRecord(node.content) && node.content.tab === "active") return path;
	for (const child of Array.isArray(node.children) ? node.children : []) {
		const found = pathToActiveTab(child, path);
		if (found !== undefined) return found;
	}
	return undefined;
}

/**
 * Insert directly before the child of the nearest `column` ancestor that
 * contains the active tab. In the shipped main layout that is `work.children`
 * before `work-body`; the tab block, pane frame and side panels are untouched.
 */
function insertionSpot(root: Json): { children: unknown[]; index: number } | undefined {
	const path = pathToActiveTab(root);
	if (path === undefined || path.length < 2) return undefined;
	for (let index = path.length - 1; index >= 1; index -= 1) {
		const parent = path[index - 1];
		const child = path[index];
		if (parent === undefined || child === undefined || parent.type !== "column" || !Array.isArray(parent.children)) continue;
		const at = parent.children.indexOf(child);
		if (at >= 0) return { children: parent.children, index: at };
	}
	return undefined;
}

function installLayoutNode(appHome: string, layoutName: string, backupDir: string): "installed" | "present" {
	const path = join(appHome, "layouts", `${layoutName}.json`);
	const original = readFileSync(path, "utf8");
	const tree: unknown = JSON.parse(original);
	if (!isRecord(tree)) throw new Error(`layout "${layoutName}" is not a layout object`);
	if (findNode(tree, BANNER_NODE_ID) !== undefined) return "present";
	const spot = insertionSpot(tree);
	if (spot === undefined) {
		throw new Error(`layout "${layoutName}" has no column above its active-tab block, so there is nowhere to place the banner`);
	}
	spot.children.splice(spot.index, 0, {
		id: BANNER_NODE_ID,
		type: "block",
		size: { px: 0 },
		content: { mod: BANNER_MOD },
	});
	backup(path, `${layoutName}.json`, backupDir);
	writeAtomic(path, `${JSON.stringify(tree, null, 2)}\n`);
	return "installed";
}

/**
 * Make the installed mod and the shown personal layout ready for the banner.
 * Callers treat `unavailable` as a diagnostic, never as a First Mate failure.
 */
export function ensureHerdrBanner(appHome: string, assets: URL): BannerSetup {
	try {
		if (!existsSync(appHome) || !statSync(appHome).isDirectory()) {
			return { state: "unavailable", detail: `the Herdr app home ${appHome} does not exist` };
		}
		const contents = new Map<string, Buffer>();
		for (const name of ASSET_NAMES) {
			try {
				contents.set(name, readFileSync(new URL(name, assets)));
			} catch {
				return { state: "unavailable", detail: `the packaged banner asset ${name} is missing` };
			}
		}
		const backupDir = join(bannerDataDir(appHome), "backups");
		const modDir = join(appHome, "mods", BANNER_MOD);
		const hadMod = existsSync(join(modDir, "main.js"));
		installAssets(appHome, contents, backupDir);

		const layoutName = shownLayout(appHome);
		if (layoutName === undefined) {
			return { state: "unavailable", detail: "the Herdr window has no shown layout yet" };
		}
		if (SHIPPED_LAYOUTS.has(layoutName)) {
			return {
				state: "unavailable",
				detail: `the shown layout "${layoutName}" is shipped by Herdr; switch to a personal layout to show the banner`,
			};
		}
		if (!existsSync(join(appHome, "layouts", `${layoutName}.json`))) {
			return { state: "unavailable", detail: `the shown layout file ${layoutName}.json is missing` };
		}
		const layout = installLayoutNode(appHome, layoutName, backupDir);
		if (layout === "present" && hadMod) return { state: "present", detail: `present in Herdr layout "${layoutName}"` };
		return { state: "installed", detail: `installed in Herdr layout "${layoutName}"` };
	} catch (error) {
		return { state: "unavailable", detail: errorText(error) };
	}
}

/**
 * Publish this session's effective mode for the banner mod. The file is
 * replaced atomically; a file left by an earlier Pi session in the same
 * terminal is removed so it cannot override this one.
 */
export function writeBannerState(appHome: string, state: BannerState): void {
	if (!SESSION_ID.test(state.sessionId)) throw new Error("invalid Pi session ID");
	if (!TERMINAL_ID.test(state.terminal)) throw new Error("invalid Core terminal address");
	const directory = bannerDataDir(appHome);
	mkdirSync(directory, { recursive: true });
	for (const name of readdirSync(directory)) {
		if (!name.endsWith(".json")) continue;
		const path = join(directory, name);
		try {
			const value: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (isRecord(value) && value.terminal === state.terminal && value.sessionId !== state.sessionId) rmSync(path, { force: true });
		} catch {
			// A damaged foreign file is ignored; it can never match the banner.
		}
	}
	writeAtomic(
		join(directory, `${state.sessionId}.json`),
		`${JSON.stringify({
			version: 1,
			sessionId: state.sessionId,
			terminal: state.terminal,
			effective: state.effective,
			updatedAt: Date.now(),
		})}\n`,
	);
}

/** Best-effort shutdown cleanup; the banner disappears as soon as this file is gone. */
export function clearBannerState(appHome: string, sessionId: string, terminal?: string): void {
	if (!SESSION_ID.test(sessionId)) return;
	const directory = bannerDataDir(appHome);
	try {
		rmSync(join(directory, `${sessionId}.json`), { force: true });
	} catch {
		// Nothing useful to do on shutdown.
	}
	if (terminal === undefined || !TERMINAL_ID.test(terminal)) return;
	// A primary session that crashed leaves a state file behind. If this
	// terminal now runs a session that must not advertise (for example a
	// worker), remove that leftover too so it cannot win by being older.
	try {
		for (const name of readdirSync(directory)) {
			if (!name.endsWith(".json")) continue;
			const path = join(directory, name);
			try {
				const value: unknown = JSON.parse(readFileSync(path, "utf8"));
				if (isRecord(value) && value.terminal === terminal && value.sessionId !== sessionId) rmSync(path, { force: true });
			} catch {
				// Ignore a damaged foreign file.
			}
		}
	} catch {
		// The directory may not exist yet.
	}
}
