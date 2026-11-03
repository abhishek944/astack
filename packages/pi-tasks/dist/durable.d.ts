import type { Extension } from "@earendil-works/pi-durable";
/** Plain serializable settings accepted at factory creation. No callbacks. */
export interface TasksDurableSettings {
    /** Maximum works per conversation. Default 100. Must be an integer from 1 to 10000. */
    readonly maxWorks?: number;
    /** Maximum todos per conversation. Default 500. Must be an integer from 1 to 10000. */
    readonly maxTodos?: number;
}
export type DurableTaskStatus = "active" | "blocked" | "completed" | "cancelled";
export type DurableWork = {
    workId: string;
    workName: string;
    workInfo: string;
    createdAt: number;
    updatedAt: number;
};
export type DurableTodo = {
    taskId: string;
    workId: string;
    taskName: string;
    taskInfo: string;
    status: DurableTaskStatus;
    blockedReason: string | null;
    completionPercent: number | null;
    createdAt: number;
    updatedAt: number;
};
/**
 * Create a native Work/Todo tracking extension from serializable settings.
 * The host opens its own Harness with models/storage/env and installs the result.
 * Record tools only: effort timing is unsupported natively (see module docs).
 */
export declare function createTasksDurableExtension(settings?: TasksDurableSettings): Extension;
