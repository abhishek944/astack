import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

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
 * Validate a task directory supplied by a resume handle. It must live below the
 * repository's var/ tree and end with this session's Work/Task identity; delegated
 * directories may have additional parent components above them.
 */
export function validateTaskDir(request: { cwd: string; sessionId: string; workId: string; taskId: string; taskDir: string }): string {
  const { cwd, sessionId, workId, taskId } = request;
  if (!SESSION_ID.test(sessionId)) throw new Error("AgentResume requires a valid host Pi session ID.");
  if (!WORK_ID.test(workId) || !TASK_ID.test(taskId)) throw new Error("AgentResume requires real Work and Task IDs.");
  const varRoot = resolve(cwd, "var");
  const directory = resolve(cwd, request.taskDir);
  const relativePath = relative(varRoot, directory);
  const segments = relativePath.split(sep);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
    || segments.length < 3 || segments.at(-3) !== sessionId || segments.at(-2) !== workId || segments.at(-1) !== taskId) {
    throw new Error("taskDir must be the canonical directory for this session/work/task below the repository's var/ tree.");
  }
  return directory;
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
