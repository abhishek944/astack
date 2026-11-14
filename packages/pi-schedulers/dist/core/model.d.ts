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
import { isSameSchedule, normalizeWeekdays, type Schedule } from "./schedule.js";
/** Legacy stored tools metadata, retained for file/CLI compatibility; it no longer restricts runs. */
export declare const DEFAULT_TOOLS: readonly ["read", "bash", "edit", "write", "grep", "find", "ls"];
/** Levels `pi --thinking` accepts. */
export declare const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** Supported public runtime-services/trust discovery version, matching the package peer minimum. */
export declare const MIN_PI_VERSION = "1.4.0";
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type Workspace = {
    mode: "root";
} | {
    mode: "existing";
    path: string;
} | {
    mode: "worktree";
    baseBranch: string;
};
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
export declare function emptyState(): TaskState;
/** Identity of the parts of a task that decide when it runs next. */
export declare function scheduleKey(task: Task): string;
/** A store-safe identifier. `entropy` is supplied by the caller's random source. */
export declare function newTaskId(now: number, entropy: string): string;
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
export type TaskErrors = Partial<Record<"name" | "prompt" | "folder" | "workspace" | "schedule" | "model" | "thinking" | "tools", string>>;
export interface TaskBuilt {
    task: Task;
}
export interface TaskInvalid {
    errors: TaskErrors;
}
/**
 * Validate a draft from the form, the CLI or the extension.
 * `existing` carries the stored task so an edit keeps its id and creation time.
 */
export declare function buildTask(input: TaskInput, now: number, existing?: Task): TaskBuilt | TaskInvalid;
/** Strict per-file parse: one bad task file is reported, the others still run. */
export declare function parseTask(value: unknown): {
    task: Task;
} | {
    error: string;
};
/** Tolerant for optional run fields, strict about the ones that matter. */
export declare function parseState(value: unknown): {
    state: TaskState;
} | {
    error: string;
};
export declare function serializeTask(task: Task): string;
export declare function serializeState(state: TaskState): string;
export declare function scheduleOrEnabledChanged(previous: Task, next: Task): boolean;
export { isSameSchedule, normalizeWeekdays };
