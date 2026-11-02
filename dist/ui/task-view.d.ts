import type { TaskState } from "../state.js";
import type { WorkWithTodos } from "../types.js";
/** Disk failures belong in the view, never in the terminal render/timer exception path. */
export declare function readTaskView(state: TaskState): {
    works: WorkWithTodos[];
    error?: string;
};
