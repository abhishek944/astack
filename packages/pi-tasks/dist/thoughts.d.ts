import type { Todo } from "./types.js";
/**
 * The only task text shown in the panel and copied details. Stored ownership,
 * links, artifact paths, and other taskInfo metadata are never visible.
 *
 * A blocked task's structured reason is the authoritative current dependency,
 * so it wins over an older progress thought. Status changes clear an unsupplied
 * thought in TaskState, which keeps resumed and completed tasks from showing a
 * stale waiting message.
 */
export declare function finalThoughtsFor(todo: Pick<Todo, "finalThoughts" | "status" | "blockedReason">): string | undefined;
