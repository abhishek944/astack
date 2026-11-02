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
export declare function taskSnapshotPath(sessionId: string): string;
export declare function emptySnapshot(sessionId: string, cwd: string): TaskSnapshot;
/** Reject damaged files rather than silently replacing user task data. */
export declare function validateSnapshot(value: unknown, sessionId: string): asserts value is TaskSnapshot;
/** Only ENOENT is an uninitialized store; parse/identity/permission failures propagate. */
export declare function readSnapshot(path: string, sessionId: string): TaskSnapshot | undefined;
/** One synchronous Pi writer, atomic replacement; Herdr is a reader only. */
export declare function writeSnapshot(path: string, snapshot: TaskSnapshot): void;
