/** The space runs are adopted into. */
export const SCHEDULERS_SPACE = "Schedulers";
/** Herdr's own worktree root (`mods/worktree/main.js`: `${home}/.herdr/worktrees`). */
export const WORKTREE_ROOT = ".herdr/worktrees";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stamp(now) {
    const date = new Date(now);
    const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const time = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
    return `${day}-${time}`;
}
function clock(now) {
    const date = new Date(now);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function shortDate(now) {
    const date = new Date(now);
    return `${MONTHS[date.getMonth()] ?? ""} ${date.getDate()}`;
}
/** `[a-z0-9-_]` slug, the character set `hc run --name` accepts. */
export function slug(value) {
    const cleaned = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return cleaned || "task";
}
function clampSlug(value, limit) {
    const cleaned = slug(value);
    return cleaned.length > limit ? cleaned.slice(0, limit).replace(/-+$/, "") || "task" : cleaned;
}
/** A Herdr tab id, so the adopted terminal lands in a tab we can name and revisit. */
export function newTabId(entropy) {
    const hex = entropy.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(32, "0").slice(0, 32);
    return `tb${hex}`;
}
/**
 * A run id that is also a valid Pi session id: letters, digits, `.`, `_`, `-`,
 * starting and ending with a letter or digit.
 */
export function newRunId(now, entropy) {
    const tail = entropy.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0").slice(0, 8);
    return `sched-${stamp(now)}-${tail}`;
}
/** The Pi session id for a run: fresh persistent session, one per dispatch. */
export function sessionIdFor(runId) {
    return runId;
}
/** The adopted terminal's name: unique among live terminals, at most 32 characters. */
export function runTerminalName(taskName, runId) {
    const tail = runId.slice(-4);
    return `${clampSlug(taskName, 26)}-${tail}`;
}
/** The tab title for a run. */
export function runTabName(taskName, now) {
    return `${taskName} · ${shortDate(now)} ${clock(now)}`;
}
export function worktreeBranch(taskName, runId) {
    return `schedulers/${clampSlug(taskName, 32)}-${runId.slice(-8)}`;
}
/** Mirror's Herdr's own worktree folder naming, so checkouts sit side by side. */
export function worktreeSlug(branch) {
    return branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
export function repoName(folder) {
    const parts = folder.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] ?? "repo";
}
/** Relative to the Herdr home's parent (the user's home). */
export function worktreePath(repo, branch) {
    return `${WORKTREE_ROOT}/${worktreeSlug(repo)}/${worktreeSlug(branch)}`;
}
/**
 * A fresh independent Pi using its normal configured tools, extensions, MCP and trust.
 * Legacy task.tools is stored for compatibility but deliberately does not restrict a run.
 * The host must preflight existing project trust before launching without a trust override.
 */
export function buildPiArgv(task, runId, piBinary, options) {
    const argv = [
        piBinary,
        "--session-id",
        sessionIdFor(runId),
        "--name",
        task.name,
    ];
    if (options.firstMateWorker)
        argv.push("--firstmate-worker");
    if (task.model)
        argv.push("--model", task.model);
    if (task.thinking)
        argv.push("--thinking", task.thinking);
    argv.push("--", task.prompt);
    return argv;
}
/**
 * `hc run` with the app's adoption labels: the terminal shows up in that space
 * and tab without moving the window's focus, unlike a `tab.new` command.
 */
export function buildAdoptionArgs(adoption) {
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
