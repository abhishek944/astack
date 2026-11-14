/**
 * The one task model and the one validation boundary.
 *
 * The Herdr mod, the `pi-schedulers` CLI and the Pi extension all validate
 * through this module, so a form save, a CLI edit and a `/schedulers` change
 * cannot disagree about what a valid task is. Pure: no I/O, no clock reads.
 *
 * Storage is one file per task (`tasks/<id>.json`) plus one file per task's run
 * state (`state/<id>.json`). Mutations share a per-task transaction lock;
 * the file split isolates malformed tasks but does not itself serialize writers.
 */
import { isSameSchedule, normalizeSchedule, normalizeWeekdays, scheduleError, } from "./schedule.js";
/** Legacy stored tools metadata, retained for file/CLI compatibility; it no longer restricts runs. */
export const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
/** Levels `pi --thinking` accepts. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** Supported public runtime-services/trust discovery version, matching the package peer minimum. */
export const MIN_PI_VERSION = "1.4.0";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FLAG_LIKE = /^-/;
export function emptyState() {
    return {
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: null,
        lastRunError: null,
        lastRunId: null,
        lastSessionId: null,
        lastFolder: null,
        lastTabId: null,
        lastTabName: null,
        runCount: 0,
        runRequestedAt: null,
        scheduleKey: null,
    };
}
/** Identity of the parts of a task that decide when it runs next. */
export function scheduleKey(task) {
    return `${task.enabled ? "on" : "off"}|${JSON.stringify(normalizeSchedule(task.schedule))}`;
}
/** A store-safe identifier. `entropy` is supplied by the caller's random source. */
export function newTaskId(now, entropy) {
    const stamp = new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `task-${stamp}-${entropy.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}`;
}
function text(value) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function absolutePath(value) {
    const raw = text(value);
    if (!raw)
        return null;
    if (raw.startsWith("/"))
        return raw;
    if (/^[A-Za-z]:[\\/]/.test(raw))
        return raw;
    return null;
}
function workspaceError(value) {
    if (!value || typeof value !== "object")
        return { errors: { workspace: "Choose where the run works." } };
    const candidate = value;
    if (candidate.mode === "root")
        return { workspace: { mode: "root" } };
    if (candidate.mode === "existing") {
        const path = absolutePath(candidate.path);
        return path
            ? { workspace: { mode: "existing", path } }
            : { errors: { workspace: "Give the existing worktree an absolute path." } };
    }
    if (candidate.mode === "worktree") {
        const base = typeof candidate.baseBranch === "string" ? candidate.baseBranch.trim() : "";
        if (FLAG_LIKE.test(base))
            return { errors: { workspace: "The base branch cannot start with a dash." } };
        return { workspace: { mode: "worktree", baseBranch: base || "HEAD" } };
    }
    return { errors: { workspace: "Choose root, an existing worktree, or a new worktree." } };
}
/**
 * Validate a draft from the form, the CLI or the extension.
 * `existing` carries the stored task so an edit keeps its id and creation time.
 */
export function buildTask(input, now, existing) {
    const errors = {};
    const name = text(input.name);
    if (!name)
        errors.name = "Give the task a name.";
    const prompt = text(input.prompt);
    if (!prompt)
        errors.prompt = "The run needs a prompt.";
    const folder = absolutePath(input.folder);
    if (!folder)
        errors.folder = "Give an absolute folder.";
    const workspace = workspaceError(input.workspace);
    const scheduleProblems = scheduleError(input.schedule);
    if (scheduleProblems)
        errors.schedule = scheduleProblems;
    let model = null;
    if (input.model !== undefined && input.model !== null && input.model !== "") {
        const candidate = text(input.model);
        if (!candidate)
            errors.model = "Use `provider/model`, or leave it empty for Pi's default.";
        else if (/\s/.test(candidate) || FLAG_LIKE.test(candidate))
            errors.model = "A model cannot contain spaces or start with a dash.";
        else
            model = candidate;
    }
    let thinking = null;
    if (input.thinking !== undefined && input.thinking !== null && input.thinking !== "") {
        const candidate = text(input.thinking);
        if (!candidate || !THINKING_LEVELS.includes(candidate)) {
            errors.thinking = `Thinking is one of ${THINKING_LEVELS.join(", ")}.`;
        }
        else
            thinking = candidate;
    }
    let tools = [...DEFAULT_TOOLS];
    if (input.tools !== undefined) {
        if (!Array.isArray(input.tools) || input.tools.length === 0)
            errors.tools = "An unattended run needs at least one tool.";
        else {
            const seen = [];
            for (const entry of input.tools) {
                const tool = text(entry);
                if (!tool || /^[+-]/.test(tool) || /\s/.test(tool)) {
                    errors.tools = "Tools are plain names; `+name` and `-name` change the default set and are not allowed here.";
                    break;
                }
                if (!seen.includes(tool))
                    seen.push(tool);
            }
            if (!errors.tools)
                tools = seen;
        }
    }
    if (errors.name ||
        errors.prompt ||
        errors.folder ||
        errors.schedule ||
        errors.model ||
        errors.thinking ||
        errors.tools ||
        "errors" in workspace) {
        const merged = "errors" in workspace ? { ...errors, ...workspace.errors } : errors;
        return { errors: merged };
    }
    const id = typeof input.id === "string" && ID.test(input.id) ? input.id : existing?.id;
    const createdAt = typeof input.createdAt === "number" && Number.isFinite(input.createdAt) ? input.createdAt : (existing?.createdAt ?? now);
    return {
        task: {
            id: id ?? newTaskId(now, Math.random().toString(36).slice(2)),
            name: name,
            prompt: prompt,
            enabled: typeof input.enabled === "boolean" ? input.enabled : (existing?.enabled ?? true),
            folder: folder,
            workspace: workspace.workspace,
            schedule: normalizeSchedule(input.schedule),
            model,
            thinking,
            tools,
            createdAt,
            updatedAt: now,
        },
    };
}
function taskProblem(task) {
    if (typeof task.id !== "string" || !ID.test(task.id))
        return "invalid id";
    if (typeof task.name !== "string" || task.name === "")
        return "no name";
    if (typeof task.prompt !== "string" || task.prompt === "")
        return "no prompt";
    if (typeof task.enabled !== "boolean")
        return "no enabled flag";
    if (!absolutePath(task.folder))
        return "no absolute folder";
    const workspace = task.workspace;
    if (!workspace || !["root", "existing", "worktree"].includes(workspace.mode))
        return "no workspace";
    if (workspace.mode === "existing" && !absolutePath(workspace.path))
        return "no existing worktree path";
    const problems = scheduleError(task.schedule);
    if (problems)
        return problems;
    if (!Array.isArray(task.tools) || task.tools.length === 0)
        return "no tool allowlist";
    if (!task.tools.every((tool) => typeof tool === "string" && tool !== ""))
        return "invalid tool allowlist";
    if (!Number.isSafeInteger(task.createdAt) || !Number.isSafeInteger(task.updatedAt))
        return "invalid timestamps";
    return null;
}
/** Strict per-file parse: one bad task file is reported, the others still run. */
export function parseTask(value) {
    if (!value || typeof value !== "object")
        return { error: "The task file is not an object." };
    const task = value;
    const problem = taskProblem(task);
    if (problem)
        return { error: `The task file is invalid: ${problem}.` };
    return { task };
}
/** Tolerant for optional run fields, strict about the ones that matter. */
export function parseState(value) {
    if (!value || typeof value !== "object")
        return { error: "The run state file is not an object." };
    const raw = value;
    const state = emptyState();
    for (const key of ["nextRunAt", "lastRunAt", "runRequestedAt"]) {
        const at = raw[key];
        if (at === undefined || at === null)
            continue;
        if (typeof at !== "number" || !Number.isFinite(at))
            return { error: `The run state has an invalid ${key}.` };
        state[key] = at;
    }
    if (raw.lastRunStatus !== undefined && raw.lastRunStatus !== null) {
        if (!["running", "succeeded", "failed"].includes(raw.lastRunStatus))
            return { error: "The run state has an invalid last run status." };
        state.lastRunStatus = raw.lastRunStatus;
    }
    for (const key of ["lastSessionId", "lastFolder", "lastTabId", "lastTabName", "lastRunId", "lastRunError"]) {
        const item = raw[key];
        if (item === undefined || item === null)
            continue;
        if (typeof item !== "string")
            return { error: `The run state has an invalid ${key}.` };
        state[key] = item;
    }
    if (raw.scheduleKey !== undefined && raw.scheduleKey !== null) {
        if (typeof raw.scheduleKey !== "string")
            return { error: "The run state has an invalid schedule key." };
        state.scheduleKey = raw.scheduleKey;
    }
    if (raw.runCount !== undefined) {
        if (!Number.isSafeInteger(raw.runCount) || raw.runCount < 0)
            return { error: "The run state has an invalid run count." };
        state.runCount = raw.runCount;
    }
    return { state };
}
export function serializeTask(task) {
    return `${JSON.stringify(task, null, 2)}\n`;
}
export function serializeState(state) {
    return `${JSON.stringify(state, null, 2)}\n`;
}
export function scheduleOrEnabledChanged(previous, next) {
    return !isSameSchedule(previous.schedule, next.schedule) || previous.enabled !== next.enabled;
}
export { isSameSchedule, normalizeWeekdays };
