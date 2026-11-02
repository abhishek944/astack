import type { TaskState } from "../state.js";
import { safeSingleLine } from "../text.js";
import type { WorkWithTodos } from "../types.js";

/** Disk failures belong in the view, never in the terminal render/timer exception path. */
export function readTaskView(state: TaskState): { works: WorkWithTodos[]; error?: string } {
  try { return { works: state.listWorks() }; }
  catch (error) {
    return { works: [], error: safeSingleLine(error instanceof Error ? error.message : "Task storage is unavailable.") };
  }
}
