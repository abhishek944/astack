import { type Task, type TaskState } from "../core/model.js";
export interface TaskEntry {
    task: Task;
    state: TaskState;
    /** Bytes read for each file, so a write can refuse a concurrent change. */
    taskRaw: string;
    stateRaw: string | null;
}
export interface Snapshot {
    records: TaskEntry[];
    /** Files that could not be used, with the reason. One bad task does not hide the rest. */
    problems: string[];
}
export declare function readTextOrNull(path: string): Promise<string | null>;
/** Create the directories an install makes; a partially installed store is an error, not an empty one. */
export declare function ensureStoreDirectories(env?: NodeJS.ProcessEnv): Promise<void>;
export declare function loadSnapshot(tasksDir: string, statesDir: string): Promise<Snapshot>;
/** @internal Shared with the legacy importer; only the exclusive creator unlinks. */
export declare function withTaskLock<T>(env: NodeJS.ProcessEnv | undefined, id: string, action: () => Promise<T>): Promise<T>;
/**
 * Save a definition, deriving its schedule transition from untouched current state.
 * An optional synchronous authorization guard runs before I/O and before the
 * definition write/commit. Once committed, the transaction finishes its state.
 */
export declare function saveTask(env: NodeJS.ProcessEnv | undefined, task: Task, expectedTaskRaw: string | null, beforeWrite?: () => void): Promise<void>;
/** Apply only this author's intent to the latest state under the shared lock. */
export declare function changeTask(env: NodeJS.ProcessEnv | undefined, id: string, expectedTaskRaw: string, operation: "run" | "enable" | "pause" | "remove"): Promise<void>;
