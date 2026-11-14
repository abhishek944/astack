/**
 * Pure run-state transitions.
 *
 * Each function takes current task/state and returns the new state. Callers
 * must hold the shared per-task transaction lock from read through write;
 * the dispatcher retains it through launch acceptance too.
 *
 * No I/O, no timers, no clock reads: the caller supplies `now`.
 */

import { emptyState, scheduleKey, scheduleOrEnabledChanged, type Task, type TaskRecord, type TaskState } from "./model.js";
import { isMissedFixedRun, nextRunAt } from "./schedule.js";

export function newStateFor(task: Task, now: number): TaskState {
  return {
    ...emptyState(),
    nextRunAt: task.enabled ? nextRunAt(task.schedule, now) : null,
    scheduleKey: scheduleKey(task),
  };
}

/**
 * Keep `nextRunAt` coherent with the definition that is actually on disk. A
 * changed key means the last save could not update both files; re-aim from now.
 */
export function reconcileState(task: Task, state: TaskState, now: number): TaskState {
  if (state.scheduleKey === scheduleKey(task)) return state;
  return {
    ...state,
    nextRunAt: task.enabled ? nextRunAt(task.schedule, now) : null,
    scheduleKey: scheduleKey(task),
  };
}

export interface DuePlan {
  dispatch: TaskRecord[];
  /** Fixed-time occurrences more than ten minutes late: re-aim, do not fire. */
  missed: TaskRecord[];
}

/** What this tick must do. A live `running` record is the durable overlap guard. */
export function planDue(records: readonly TaskRecord[], now: number): DuePlan {
  const dispatch: TaskRecord[] = [];
  const missed: TaskRecord[] = [];
  for (const record of records) {
    const { task, state } = record;
    if (!task.enabled) continue;
    if (state.lastRunStatus === "running") continue;
    const requested = state.runRequestedAt !== null;
    if (!requested) {
      const due = state.nextRunAt;
      if (due === null || due > now) continue;
      if (isMissedFixedRun(task.schedule, due, now)) {
        missed.push(record);
        continue;
      }
    }
    dispatch.push(record);
  }
  return { dispatch, missed };
}

/** The instant a dispatch stands for; rechecked under the task lock. */
export function dueInstant(state: TaskState, now: number): number {
  return state.runRequestedAt ?? state.nextRunAt ?? now;
}

/** The overlap guard begins here, inside the dispatcher's task transaction. */
export function beginRun(state: TaskState, runId: string, now: number): TaskState {
  return {
    ...state,
    lastRunStatus: "running",
    lastRunAt: now,
    lastRunId: runId,
    lastRunError: null,
    runRequestedAt: null,
  };
}

export interface AcceptedRun {
  runId: string;
  /** When the launch was accepted, not when the agent finished. */
  acceptedAt: number;
  sessionId: string;
  folder: string;
  tabId: string | null;
  tabName: string;
}

export function finishRun(state: TaskState, task: Task, run: AcceptedRun): TaskState {
  return {
    ...state,
    lastRunStatus: "succeeded",
    lastRunError: null,
    lastRunAt: run.acceptedAt,
    lastRunId: run.runId,
    lastSessionId: run.sessionId,
    lastFolder: run.folder,
    lastTabId: run.tabId,
    lastTabName: run.tabName,
    runCount: state.runCount + 1,
    nextRunAt: nextRunAt(task.schedule, run.acceptedAt),
    runRequestedAt: null,
    scheduleKey: scheduleKey(task),
  };
}

/** A dispatch that never reached acceptance. The next run moves forward; nothing is replayed. */
export function failRun(state: TaskState, task: Task, runId: string | null, error: string, now: number): TaskState {
  return {
    ...state,
    lastRunStatus: "failed",
    lastRunError: error,
    lastRunId: runId ?? state.lastRunId,
    lastRunAt: now,
    runCount: state.runCount + 1,
    nextRunAt: nextRunAt(task.schedule, now),
    runRequestedAt: null,
    scheduleKey: scheduleKey(task),
  };
}

export function requestRun(state: TaskState, now: number): TaskState {
  if (state.lastRunStatus === "running") throw new Error("This task is dispatching or was interrupted. No run was requested; inspect its owner first.");
  if (state.runRequestedAt !== null) throw new Error("A run is already requested for this task.");
  return { ...state, runRequestedAt: now };
}

/**
 * State after a definition save. Keeps `nextRunAt` unless the schedule or the
 * enabled flag changed, so editing a prompt never postpones a due run.
 */
export function stateAfterEdit(previous: TaskRecord | null, task: Task, now: number): TaskState {
  if (!previous) return newStateFor(task, now);
  let next = previous.state.nextRunAt;
  if (!task.enabled) next = null;
  else if (!previous.task.enabled || scheduleOrEnabledChanged(previous.task, task) || next === null) {
    next = nextRunAt(task.schedule, now);
  }
  return { ...previous.state, nextRunAt: next, scheduleKey: scheduleKey(task) };
}

export function setEnabledState(state: TaskState, task: Task, enabled: boolean, now: number): TaskState {
  return {
    ...state,
    nextRunAt: enabled ? nextRunAt(task.schedule, now) : null,
    runRequestedAt: enabled ? state.runRequestedAt : null,
    scheduleKey: scheduleKey(task),
  };
}

export function reaimMissed(state: TaskState, task: Task, now: number): TaskState {
  return { ...state, nextRunAt: nextRunAt(task.schedule, now), scheduleKey: scheduleKey(task) };
}

export function findRecord(records: readonly TaskRecord[], id: string): TaskRecord | undefined {
  return records.find((record) => record.task.id === id);
}

/** Resolve an id, id prefix or name. Ambiguity is an error, never a guess. */
export function matchRecords(records: readonly TaskRecord[], needle: string): TaskRecord[] {
  const wanted = needle.trim();
  if (!wanted) return [];
  const exact = records.filter((record) => record.task.id === wanted);
  if (exact.length) return exact;
  const byName = records.filter((record) => record.task.name.toLowerCase() === wanted.toLowerCase());
  if (byName.length) return byName;
  return records.filter((record) => record.task.id.startsWith(wanted));
}
