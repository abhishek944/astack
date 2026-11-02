import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { taskOwner } from "./ownership.js";
import type { Todo, Work } from "./types.js";

/** Shared on-disk contract for Pi and the read-only Herdr mod. */
export interface TaskSnapshot {
  version: 1;
  sessionId: string;
  cwd: string;
  terminalId?: string;
  updatedAt: number;
  nextWorkId: number;
  nextTaskId: number;
  works: Work[];
  todos: Todo[];
  agentRunning: boolean;
  focusedTaskId?: string;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TERMINAL_ID = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?t[0-9a-z]+$/;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const id = (value: unknown, prefix: string): value is string => typeof value === "string" && new RegExp(`^${prefix}[1-9][0-9]*$`).test(value) && integer(Number(value.slice(1)));

export function taskSnapshotPath(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("A valid Pi session ID is required for task storage.");
  return join(getAgentDir(), "tasks", `${sessionId}.json`);
}

export function emptySnapshot(sessionId: string, cwd: string): TaskSnapshot {
  return { version: 1, sessionId, cwd, updatedAt: Date.now(), nextWorkId: 1, nextTaskId: 1, works: [], todos: [], agentRunning: false };
}

/** Reject damaged files rather than silently replacing user task data. */
export function validateSnapshot(value: unknown, sessionId: string): asserts value is TaskSnapshot {
  const invalid = () => { throw new Error("Invalid task snapshot. Restore the file from backup; it has not been overwritten."); };
  if (!object(value) || value.version !== 1 || value.sessionId !== sessionId || !text(value.cwd)
    || !integer(value.updatedAt) || !integer(value.nextWorkId) || value.nextWorkId < 1
    || !integer(value.nextTaskId) || value.nextTaskId < 1 || typeof value.agentRunning !== "boolean"
    || !Array.isArray(value.works) || value.works.length > 100 || !Array.isArray(value.todos) || value.todos.length > 500
    || (value.terminalId !== undefined && (typeof value.terminalId !== "string" || !TERMINAL_ID.test(value.terminalId)))) return invalid();
  const works = new Set<string>();
  for (const work of value.works) {
    if (!object(work) || !id(work.workId, "W") || works.has(work.workId) || !text(work.workName) || !text(work.workInfo)
      || !integer(work.createdAt) || !integer(work.updatedAt) || Number(work.workId.slice(1)) >= value.nextWorkId) return invalid();
    works.add(work.workId);
  }
  const todos = new Set<string>();
  let running = 0;
  for (const todo of value.todos) {
    if (!object(todo) || !id(todo.taskId, "T") || todos.has(todo.taskId) || !text(todo.workId) || !works.has(todo.workId)
      || !text(todo.taskName) || !text(todo.taskInfo) || !integer(todo.createdAt) || !integer(todo.updatedAt)
      || !["active", "blocked", "completed", "cancelled"].includes(String(todo.status))
      || Number(todo.taskId.slice(1)) >= value.nextTaskId
      || (todo.blockedReason !== undefined && todo.blockedReason !== null && !text(todo.blockedReason))
      || (todo.status !== "blocked" && todo.blockedReason != null)
      || (todo.completionPercent != null && (!integer(todo.completionPercent) || todo.completionPercent > 100))
      || (todo.status === "completed" && todo.completionPercent !== 100)
      || (todo.status !== "completed" && todo.completionPercent === 100)
      || (todo.elapsedMs != null && !integer(todo.elapsedMs))) return invalid();
    if (todo.delegatedTimes !== undefined) {
      if (!Array.isArray(todo.delegatedTimes)) return invalid();
      const reports = new Set<string>();
      for (const source of todo.delegatedTimes) {
        if (!object(source) || !text(source.reportPath) || reports.has(source.reportPath)
          || (source.elapsedMs !== null && !integer(source.elapsedMs))
          || (source.workerSessionId !== undefined && (typeof source.workerSessionId !== "string" || !SESSION_ID.test(source.workerSessionId)))) return invalid();
        reports.add(source.reportPath);
      }
    }
    if (todo.workingSince !== undefined) {
      if (!integer(todo.workingSince) || !value.agentRunning || value.focusedTaskId !== todo.taskId || todo.status !== "active" || taskOwner(todo.taskInfo) !== "self") return invalid();
      running += 1;
    }
    todos.add(todo.taskId);
  }
  if (running > 1 || (value.focusedTaskId !== undefined && (!id(value.focusedTaskId, "T") || !todos.has(value.focusedTaskId)))) return invalid();
  if (value.focusedTaskId !== undefined) {
    const focused = value.todos.find((todo) => todo.taskId === value.focusedTaskId);
    if (focused?.status !== "active" || taskOwner(focused.taskInfo) !== "self") return invalid();
  }
}

/** Only ENOENT is an uninitialized store; parse/identity/permission failures propagate. */
export function readSnapshot(path: string, sessionId: string): TaskSnapshot | undefined {
  let contents: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) throw new Error("Task snapshot must be a regular file no larger than 16 MiB.");
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let snapshot: unknown;
  try { snapshot = JSON.parse(contents); }
  catch { throw new Error("Task snapshot is not valid JSON. It has not been overwritten."); }
  validateSnapshot(snapshot, sessionId);
  return snapshot;
}

/** One synchronous Pi writer, atomic replacement; Herdr is a reader only. */
export function writeSnapshot(path: string, snapshot: TaskSnapshot): void {
  validateSnapshot(snapshot, snapshot.sessionId);
  const data = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(data) > MAX_SNAPSHOT_BYTES) throw new Error("Task snapshot exceeds 16 MiB; no changes were saved.");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch { /* Preserve the original write error if cleanup also fails. */ }
  }
}
