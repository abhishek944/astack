/**
 * Pure dispatch plan: identifiers, the Pi command line for an unattended run,
 * and the `hc run` adoption arguments that put that run in its own tab.
 *
 * The mod and the CLI build their commands here, so there is one definition of
 * what a scheduled run is. No I/O, no clock reads.
 */
import type { Task } from "./model.js";

/** The space runs are adopted into. */
export const SCHEDULERS_SPACE = "Schedulers";

/** Herdr's own worktree root (`mods/worktree/main.js`: `${home}/.herdr/worktrees`). */
export const WORKTREE_ROOT = ".herdr/worktrees";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function stamp(now: number): string {
  const date = new Date(now);
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const time = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
  return `${day}-${time}`;
}

function clock(now: number): string {
  const date = new Date(now);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function shortDate(now: number): string {
  const date = new Date(now);
  return `${MONTHS[date.getMonth()] ?? ""} ${date.getDate()}`;
}

/** `[a-z0-9-_]` slug, the character set `hc run --name` accepts. */
export function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "task";
}

function clampSlug(value: string, limit: number): string {
  const cleaned = slug(value);
  return cleaned.length > limit ? cleaned.slice(0, limit).replace(/-+$/, "") || "task" : cleaned;
}

/** A Herdr tab id, so the adopted terminal lands in a tab we can name and revisit. */
export function newTabId(entropy: string): string {
  const hex = entropy.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(32, "0").slice(0, 32);
  return `tb${hex}`;
}

/**
 * A run id that is also a valid Pi session id: letters, digits, `.`, `_`, `-`,
 * starting and ending with a letter or digit.
 */
export function newRunId(now: number, entropy: string): string {
  const tail = entropy.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0").slice(0, 8);
  return `sched-${stamp(now)}-${tail}`;
}

/** The Pi session id for a run: fresh persistent session, one per dispatch. */
export function sessionIdFor(runId: string): string {
  return runId;
}

/** The adopted terminal's name: unique among live terminals, at most 32 characters. */
export function runTerminalName(taskName: string, runId: string): string {
  const tail = runId.slice(-4);
  return `${clampSlug(taskName, 26)}-${tail}`;
}

/** The tab title for a run. */
export function runTabName(taskName: string, now: number): string {
  return `${taskName} · ${shortDate(now)} ${clock(now)}`;
}

export function worktreeBranch(taskName: string, runId: string): string {
  return `schedulers/${clampSlug(taskName, 32)}-${runId.slice(-8)}`;
}

/** Mirror's Herdr's own worktree folder naming, so checkouts sit side by side. */
export function worktreeSlug(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function repoName(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "repo";
}

/** Relative to the Herdr home's parent (the user's home). */
export function worktreePath(repo: string, branch: string): string {
  return `${WORKTREE_ROOT}/${worktreeSlug(repo)}/${worktreeSlug(branch)}`;
}

export interface LaunchOptions {
  /** True only when normal Pi resource discovery registered the supported boolean flag. */
  firstMateWorker: boolean;
}

/**
 * A fresh independent Pi using its normal configured tools, extensions, MCP and trust.
 * Legacy task.tools is stored for compatibility but deliberately does not restrict a run.
 * The host must preflight existing project trust before launching without a trust override.
 */
export function buildPiArgv(task: Task, runId: string, piBinary: string, options: LaunchOptions): string[] {
  const argv = [
    piBinary,
    "--session-id",
    sessionIdFor(runId),
    "--name",
    task.name,
  ];
  if (options.firstMateWorker) argv.push("--firstmate-worker");
  if (task.model) argv.push("--model", task.model);
  if (task.thinking) argv.push("--thinking", task.thinking);
  argv.push("--", task.prompt);
  return argv;
}

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
export function buildAdoptionArgs(adoption: Adoption): string[] {
  return [
    "run",
    "--json",
    "--bg",
    "--no-parent",
    "--keep",
    "--cwd",
    adoption.folder,
    "--name",
    adoption.terminalName,
    "--label",
    `herdr.space=${adoption.spaceId}`,
    "--label",
    `herdr.tab=${adoption.tabId}`,
    "--",
    ...adoption.argv,
  ];
}
