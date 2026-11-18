export interface TaskDirRequest {
    cwd: string;
    sessionId: string;
    workId: string;
    taskId: string;
    /** Exact parentTaskDir from a delegated assignment; omit in a root session. */
    parentTaskDir?: string;
}
/**
 * Validate a task directory supplied by a resume handle. It must live below the
 * repository's var/ tree and end with this session's Work/Task identity; delegated
 * directories may have additional parent components above them.
 */
export declare function validateTaskDir(request: {
    cwd: string;
    sessionId: string;
    workId: string;
    taskId: string;
    taskDir: string;
}): string;
/**
 * Resolve the canonical delegated-task artifact directory for AgentCreate.
 * Root: <cwd>/var/<sessionId>/<workId>/<taskId>.
 * Delegated: <parentTaskDir>/<sessionId>/<workId>/<taskId>.
 */
export declare function deriveTaskDir(request: TaskDirRequest): string;
