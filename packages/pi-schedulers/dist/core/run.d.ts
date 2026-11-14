/**
 * Pure dispatch plan: identifiers, the Pi command line for an unattended run,
 * and the `hc run` adoption arguments that put that run in its own tab.
 *
 * The mod and the CLI build their commands here, so there is one definition of
 * what a scheduled run is. No I/O, no clock reads.
 */
import type { Task } from "./model.js";
/** The space runs are adopted into. */
export declare const SCHEDULERS_SPACE = "Schedulers";
/** Herdr's own worktree root (`mods/worktree/main.js`: `${home}/.herdr/worktrees`). */
export declare const WORKTREE_ROOT = ".herdr/worktrees";
/** `[a-z0-9-_]` slug, the character set `hc run --name` accepts. */
export declare function slug(value: string): string;
/** A Herdr tab id, so the adopted terminal lands in a tab we can name and revisit. */
export declare function newTabId(entropy: string): string;
/**
 * A run id that is also a valid Pi session id: letters, digits, `.`, `_`, `-`,
 * starting and ending with a letter or digit.
 */
export declare function newRunId(now: number, entropy: string): string;
/** The Pi session id for a run: fresh persistent session, one per dispatch. */
export declare function sessionIdFor(runId: string): string;
/** The adopted terminal's name: unique among live terminals, at most 32 characters. */
export declare function runTerminalName(taskName: string, runId: string): string;
/** The tab title for a run. */
export declare function runTabName(taskName: string, now: number): string;
export declare function worktreeBranch(taskName: string, runId: string): string;
/** Mirror's Herdr's own worktree folder naming, so checkouts sit side by side. */
export declare function worktreeSlug(branch: string): string;
export declare function repoName(folder: string): string;
/** Relative to the Herdr home's parent (the user's home). */
export declare function worktreePath(repo: string, branch: string): string;
export interface LaunchOptions {
    /** True only when normal Pi resource discovery registered the supported boolean flag. */
    firstMateWorker: boolean;
}
/**
 * A fresh independent Pi using its normal configured tools, extensions, MCP and trust.
 * Legacy task.tools is stored for compatibility but deliberately does not restrict a run.
 * The host must preflight existing project trust before launching without a trust override.
 */
export declare function buildPiArgv(task: Task, runId: string, piBinary: string, options: LaunchOptions): string[];
export interface Adoption {
    spaceId: string;
    tabId: string;
    folder: string;
    terminalName: string;
    argv: string[];
}
/**
 * `hc run` with the app's adoption labels: the terminal shows up in that space
 * and tab without moving the window's focus, unlike a `tab.new` command.
 */
export declare function buildAdoptionArgs(adoption: Adoption): string[];
