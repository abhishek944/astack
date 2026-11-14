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
import {
  isSameSchedule,
  normalizeSchedule,
  normalizeWeekdays,
  type Schedule,
  scheduleError,
} from "./schedule.js";

/** Legacy stored tools metadata, retained for file/CLI compatibility; it no longer restricts runs. */
export const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

/** Levels `pi --thinking` accepts. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Supported public runtime-services/trust discovery version, matching the package peer minimum. */
export const MIN_PI_VERSION = "1.4.0";

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type Workspace =
  | { mode: "root" }
  | { mode: "existing"; path: string }
  | { mode: "worktree"; baseBranch: string };

export interface Task {
  /** Also the file name; immutable for the life of the task. */
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  /** Absolute folder the run starts in, before any workspace override. */
  folder: string;
  workspace: Workspace;
  schedule: Schedule;
  /** Pi's `provider/model` (optionally `:thinking`); null uses Pi's own default. */
  model: string | null;
  thinking: ThinkingLevel | null;
  /** Legacy metadata only. Scheduled Pi uses its normal configured toolset instead. */
  tools: string[];
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = "running" | "succeeded" | "failed";

/**
 * Durable run state. Callers hold the task lock across current-state decisions
 * and writes so completion cannot clobber an accepted authoring action.
 */
export interface TaskState {
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: RunStatus | null;
  lastRunError: string | null;
  lastRunId: string | null;
  lastSessionId: string | null;
  lastFolder: string | null;
  lastTabId: string | null;
  lastTabName: string | null;
  runCount: number;
  /** A run-now request from Pi; the dispatcher honours it on its next tick. */
  runRequestedAt: number | null;
  /**
   * The schedule and enabled flag this `nextRunAt` was computed from. A
   * definition save that moved the schedule but could not update the state file
   * is corrected on the next tick instead of firing at a stale instant.
   */
  scheduleKey: string | null;
}

export interface TaskRecord {
  task: Task;
  state: TaskState;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FLAG_LIKE = /^-/;

export function emptyState(): TaskState {
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
export function scheduleKey(task: Task): string {
  return `${task.enabled ? "on" : "off"}|${JSON.stringify(normalizeSchedule(task.schedule))}`;
}

/** A store-safe identifier. `entropy` is supplied by the caller's random source. */
export function newTaskId(now: number, entropy: string): string {
  const stamp = new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `task-${stamp}-${entropy.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function absolutePath(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (raw.startsWith("/")) return raw;
  if (/^[A-Za-z]:[\\/]/.test(raw)) return raw;
  return null;
}

export interface TaskInput {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  enabled?: unknown;
  folder?: unknown;
  workspace?: unknown;
  schedule?: unknown;
  model?: unknown;
  thinking?: unknown;
  tools?: unknown;
  createdAt?: unknown;
}

export type TaskErrors = Partial<
  Record<"name" | "prompt" | "folder" | "workspace" | "schedule" | "model" | "thinking" | "tools", string>
>;

export interface TaskBuilt {
  task: Task;
}

export interface TaskInvalid {
  errors: TaskErrors;
}

function workspaceError(value: unknown): { errors: TaskErrors } | { workspace: Workspace } {
  if (!value || typeof value !== "object") return { errors: { workspace: "Choose where the run works." } };
  const candidate = value as { mode?: unknown; path?: unknown; baseBranch?: unknown };
  if (candidate.mode === "root") return { workspace: { mode: "root" } };
  if (candidate.mode === "existing") {
    const path = absolutePath(candidate.path);
    return path
      ? { workspace: { mode: "existing", path } }
      : { errors: { workspace: "Give the existing worktree an absolute path." } };
  }
  if (candidate.mode === "worktree") {
    const base = typeof candidate.baseBranch === "string" ? candidate.baseBranch.trim() : "";
    if (FLAG_LIKE.test(base)) return { errors: { workspace: "The base branch cannot start with a dash." } };
    return { workspace: { mode: "worktree", baseBranch: base || "HEAD" } };
  }
  return { errors: { workspace: "Choose root, an existing worktree, or a new worktree." } };
}

/**
 * Validate a draft from the form, the CLI or the extension.
 * `existing` carries the stored task so an edit keeps its id and creation time.
 */
export function buildTask(input: TaskInput, now: number, existing?: Task): TaskBuilt | TaskInvalid {
  const errors: TaskErrors = {};

  const name = text(input.name);
  if (!name) errors.name = "Give the task a name.";

  const prompt = text(input.prompt);
  if (!prompt) errors.prompt = "The run needs a prompt.";

  const folder = absolutePath(input.folder);
  if (!folder) errors.folder = "Give an absolute folder.";

  const workspace = workspaceError(input.workspace);

  const scheduleProblems = scheduleError(input.schedule);
  if (scheduleProblems) errors.schedule = scheduleProblems;

  let model: string | null = null;
  if (input.model !== undefined && input.model !== null && input.model !== "") {
    const candidate = text(input.model);
    if (!candidate) errors.model = "Use `provider/model`, or leave it empty for Pi's default.";
    else if (/\s/.test(candidate) || FLAG_LIKE.test(candidate))
      errors.model = "A model cannot contain spaces or start with a dash.";
    else model = candidate;
  }

  let thinking: ThinkingLevel | null = null;
  if (input.thinking !== undefined && input.thinking !== null && input.thinking !== "") {
    const candidate = text(input.thinking);
    if (!candidate || !(THINKING_LEVELS as readonly string[]).includes(candidate)) {
      errors.thinking = `Thinking is one of ${THINKING_LEVELS.join(", ")}.`;
    } else thinking = candidate as ThinkingLevel;
  }

  let tools: string[] = [...DEFAULT_TOOLS];
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools) || input.tools.length === 0) errors.tools = "An unattended run needs at least one tool.";
    else {
      const seen: string[] = [];
      for (const entry of input.tools) {
        const tool = text(entry);
        if (!tool || /^[+-]/.test(tool) || /\s/.test(tool)) {
          errors.tools = "Tools are plain names; `+name` and `-name` change the default set and are not allowed here.";
          break;
        }
        if (!seen.includes(tool)) seen.push(tool);
      }
      if (!errors.tools) tools = seen;
    }
  }

  if (
    errors.name ||
    errors.prompt ||
    errors.folder ||
    errors.schedule ||
    errors.model ||
    errors.thinking ||
    errors.tools ||
    "errors" in workspace
  ) {
    const merged = "errors" in workspace ? { ...errors, ...workspace.errors } : errors;
    return { errors: merged };
  }

  const id = typeof input.id === "string" && ID.test(input.id) ? input.id : existing?.id;
  const createdAt =
    typeof input.createdAt === "number" && Number.isFinite(input.createdAt) ? input.createdAt : (existing?.createdAt ?? now);

  return {
    task: {
      id: id ?? newTaskId(now, Math.random().toString(36).slice(2)),
      name: name as string,
      prompt: prompt as string,
      enabled: typeof input.enabled === "boolean" ? input.enabled : (existing?.enabled ?? true),
      folder: folder as string,
      workspace: (workspace as { workspace: Workspace }).workspace,
      schedule: normalizeSchedule(input.schedule as Schedule),
      model,
      thinking,
      tools,
      createdAt,
      updatedAt: now,
    },
  };
}

function taskProblem(task: Partial<Task>): string | null {
  if (typeof task.id !== "string" || !ID.test(task.id)) return "invalid id";
  if (typeof task.name !== "string" || task.name === "") return "no name";
  if (typeof task.prompt !== "string" || task.prompt === "") return "no prompt";
  if (typeof task.enabled !== "boolean") return "no enabled flag";
  if (!absolutePath(task.folder)) return "no absolute folder";
  const workspace = task.workspace as Workspace | undefined;
  if (!workspace || !["root", "existing", "worktree"].includes(workspace.mode)) return "no workspace";
  if (workspace.mode === "existing" && !absolutePath((workspace as { path?: string }).path))
    return "no existing worktree path";
  const problems = scheduleError(task.schedule);
  if (problems) return problems;
  if (!Array.isArray(task.tools) || task.tools.length === 0) return "no tool allowlist";
  if (!task.tools.every((tool) => typeof tool === "string" && tool !== "")) return "invalid tool allowlist";
  if (!Number.isSafeInteger(task.createdAt) || !Number.isSafeInteger(task.updatedAt)) return "invalid timestamps";
  return null;
}

/** Strict per-file parse: one bad task file is reported, the others still run. */
export function parseTask(value: unknown): { task: Task } | { error: string } {
  if (!value || typeof value !== "object") return { error: "The task file is not an object." };
  const task = value as Task;
  const problem = taskProblem(task);
  if (problem) return { error: `The task file is invalid: ${problem}.` };
  return { task };
}

/** Tolerant for optional run fields, strict about the ones that matter. */
export function parseState(value: unknown): { state: TaskState } | { error: string } {
  if (!value || typeof value !== "object") return { error: "The run state file is not an object." };
  const raw = value as Partial<TaskState>;
  const state = emptyState();
  for (const key of ["nextRunAt", "lastRunAt", "runRequestedAt"] as const) {
    const at = raw[key];
    if (at === undefined || at === null) continue;
    if (typeof at !== "number" || !Number.isFinite(at)) return { error: `The run state has an invalid ${key}.` };
    state[key] = at;
  }
  if (raw.lastRunStatus !== undefined && raw.lastRunStatus !== null) {
    if (!["running", "succeeded", "failed"].includes(raw.lastRunStatus as string))
      return { error: "The run state has an invalid last run status." };
    state.lastRunStatus = raw.lastRunStatus as RunStatus;
  }
  for (const key of ["lastSessionId", "lastFolder", "lastTabId", "lastTabName", "lastRunId", "lastRunError"] as const) {
    const item = raw[key];
    if (item === undefined || item === null) continue;
    if (typeof item !== "string") return { error: `The run state has an invalid ${key}.` };
    state[key] = item;
  }
  if (raw.scheduleKey !== undefined && raw.scheduleKey !== null) {
    if (typeof raw.scheduleKey !== "string") return { error: "The run state has an invalid schedule key." };
    state.scheduleKey = raw.scheduleKey;
  }
  if (raw.runCount !== undefined) {
    if (!Number.isSafeInteger(raw.runCount) || (raw.runCount as number) < 0) return { error: "The run state has an invalid run count." };
    state.runCount = raw.runCount as number;
  }
  return { state };
}

export function serializeTask(task: Task): string {
  return `${JSON.stringify(task, null, 2)}\n`;
}

export function serializeState(state: TaskState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function scheduleOrEnabledChanged(previous: Task, next: Task): boolean {
  return !isSameSchedule(previous.schedule, next.schedule) || previous.enabled !== next.enabled;
}

export { isSameSchedule, normalizeWeekdays };
