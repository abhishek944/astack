import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DelegatedTime, Todo, TodoStatus, Work, WorkWithTodos } from "./types.js";
/** Legacy session entries are read once for migration, never written again. */
export declare const TASK_ENTRY_TYPE = "pi-tasks-state";
export declare const MAX_WORKS = 100;
export declare const MAX_TODOS = 500;
/** File-backed session state. Only the binding lives here, never an authoritative record cache. */
export declare class TaskState {
    private readonly onChange;
    private binding;
    constructor(_pi: ExtensionAPI, onChange: () => void);
    get snapshotPath(): string;
    restore(ctx: ExtensionContext, freshFork?: boolean): void;
    private read;
    private change;
    listWorks(filter?: {
        workId?: string;
    }): WorkWithTodos[];
    listTodos(filter?: {
        taskId?: string;
        workId?: string;
        status?: TodoStatus;
    }): Todo[];
    getWork(workId: string): Work | undefined;
    getTodo(taskId: string): Todo | undefined;
    setAgentRunning(running: boolean): void;
    setWorking(taskId: string, working: boolean): void;
    clearWorking(): void;
    createWork(workName: string, workInfo: string): Work;
    updateWork(workId: string, patch: Partial<Pick<Work, "workName" | "workInfo">>): Work;
    deleteWork(workId: string): boolean;
    createTodo(workId: string, taskName: string, taskInfo: string, status?: TodoStatus, completionPercent?: number | null, blockedReason?: string | null): Todo;
    updateTodo(taskId: string, patch: Partial<Pick<Todo, "taskName" | "taskInfo" | "status" | "blockedReason" | "completionPercent">> & {
        working?: boolean;
    }): Todo;
    setDelegatedTime(taskId: string, source: DelegatedTime): void;
    deleteTodo(taskId: string): boolean;
}
