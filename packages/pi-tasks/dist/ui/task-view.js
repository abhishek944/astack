import { safeSingleLine } from "../text.js";
/** Disk failures belong in the view, never in the terminal render/timer exception path. */
export function readTaskView(state) {
    try {
        return { works: state.listWorks() };
    }
    catch (error) {
        return { works: [], error: safeSingleLine(error instanceof Error ? error.message : "Task storage is unavailable.") };
    }
}
