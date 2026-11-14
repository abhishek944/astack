/**
 * Pure run-state transitions.
 *
 * Each function takes current task/state and returns the new state. Callers
 * must hold the shared per-task transaction lock from read through write;
 * the dispatcher retains it through launch acceptance too.
 *
 * No I/O, no timers, no clock reads: the caller supplies `now`.
 */
import { type Task, type TaskRecord, type TaskState } from "./model.js";
export declare function newStateFor(task: Task, now: number): TaskState;
/**
 * Keep `nextRunAt` coherent with the definition that is actually on disk. A
 * changed key means the last save could not update both files; re-aim from now.
 */
export declare function reconcileState(task: Task, state: TaskState, now: number): TaskState;
export interface DuePlan {
    dispatch: TaskRecord[];
    /** Fixed-time occurrences more than ten minutes late: re-aim, do not fire. */
    missed: TaskRecord[];
}
/** What this tick must do. A live `running` record is the durable overlap guard. */
export declare function planDue(records: readonly TaskRecord[], now: number): DuePlan;
/** The instant a dispatch stands for; rechecked under the task lock. */
export declare function dueInstant(state: TaskState, now: number): number;
/** The overlap guard begins here, inside the dispatcher's task transaction. */
export declare function beginRun(state: TaskState, runId: string, now: number): TaskState;
export interface AcceptedRun {
    runId: string;
    /** When the launch was accepted, not when the agent finished. */
    acceptedAt: number;
    sessionId: string;
    folder: string;
    tabId: string | null;
    tabName: string;
}
export declare function finishRun(state: TaskState, task: Task, run: AcceptedRun): TaskState;
/** A dispatch that never reached acceptance. The next run moves forward; nothing is replayed. */
export declare function failRun(state: TaskState, task: Task, runId: string | null, error: string, now: number): TaskState;
export declare function requestRun(state: TaskState, now: number): TaskState;
/**
 * State after a definition save. Keeps `nextRunAt` unless the schedule or the
 * enabled flag changed, so editing a prompt never postpones a due run.
 */
export declare function stateAfterEdit(previous: TaskRecord | null, task: Task, now: number): TaskState;
export declare function setEnabledState(state: TaskState, task: Task, enabled: boolean, now: number): TaskState;
export declare function reaimMissed(state: TaskState, task: Task, now: number): TaskState;
export declare function findRecord(records: readonly TaskRecord[], id: string): TaskRecord | undefined;
/** Resolve an id, id prefix or name. Ambiguity is an error, never a guess. */
export declare function matchRecords(records: readonly TaskRecord[], needle: string): TaskRecord[];
