import { basename, dirname, resolve } from "node:path";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const WORK_ID = /^W[1-9][0-9]*$/;
const TASK_ID = /^T[1-9][0-9]*$/;

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
export function deriveTaskDir(request: TaskDirRequest): string {
  const { cwd, sessionId, workId, taskId, parentTaskDir } = request;
  if (!SESSION_ID.test(sessionId)) throw new Error("AgentCreate requires a valid host Pi session ID.");
  if (!WORK_ID.test(workId) || !TASK_ID.test(taskId)) throw new Error("AgentCreate requires real Work and Task IDs.");
  const varRoot = resolve(cwd, "var");
  if (parentTaskDir === undefined) return resolve(varRoot, sessionId, workId, taskId);

  const base = resolve(cwd, parentTaskDir);
  const baseSessionId = basename(dirname(dirname(base)));
  const baseWorkId = basename(dirname(base));
  const baseTaskId = basename(base);
  if (!SESSION_ID.test(baseSessionId) || !WORK_ID.test(baseWorkId) || !TASK_ID.test(baseTaskId)) {
    throw new Error("parentTaskDir must be the exact canonical task directory from your assignment (.../<sessionId>/<workId>/<taskId>), or omitted in a root session.");
  }
  if (baseSessionId === sessionId) throw new Error("Pass the parentTaskDir from your assignment, not your own task directory. Omit it in a root session.");
  return resolve(base, sessionId, workId, taskId);
}
