export interface TaskDirRequest {
    cwd: string;
    sessionId: string;
    workId: string;
    taskId: string;
    /** Exact parentTaskDir from a delegated assignment; omit in a root session. */
    parentTaskDir?: string;
}
/**
 * Resolve the canonical delegated-task artifact directory for AgentCreate.
 * Root: <cwd>/var/<sessionId>/<workId>/<taskId>.
 * Delegated: <parentTaskDir>/<sessionId>/<workId>/<taskId>.
 */
export declare function deriveTaskDir(request: TaskDirRequest): string;
