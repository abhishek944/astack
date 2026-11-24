import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hasMainWork } from "./delegation.js";
import { hc, object, TERMINAL_ID } from "./herdr.js";

const TASK_ID = /^T[1-9][0-9]*$/;

interface CleanupCandidate {
  taskId: string;
  terminalId: string;
}

function candidateFromDetails(details: unknown): CleanupCandidate | undefined {
  const record = object(details);
  const data = object(record?.data);
  if (record?.action !== "todo-update" || data?.status !== "completed" || data.completedTransition !== true) return undefined;
  const { taskId } = data;
  // pi-tasks publishes the linked Core address as cleanupTerminalId in TodoUpdate result data.
  const terminalId = data.cleanupTerminalId;
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)
    || typeof terminalId !== "string" || !TERMINAL_ID.test(terminalId)) return undefined;
  return { taskId, terminalId };
}

async function ownsOpenWorker(input: { terminalId: string; taskId: string; sessionId: string; cwd: string }): Promise<boolean> {
  const parentId = process.env.HC_TERMINAL_ID;
  if (!parentId || !TERMINAL_ID.test(parentId) || !TERMINAL_ID.test(input.terminalId)) return false;
  try {
    const terminal = await hc(["get", input.terminalId], input.cwd);
    if (terminal.parent !== parentId) return false;
    const labels = object(terminal.labels);
    return labels?.["pi.session"] === input.sessionId && labels?.["pi.task"] === input.taskId;
  } catch {
    return false;
  }
}

function advisoryText(candidate: CleanupCandidate): string {
  return [
    `Advisory only: ${candidate.taskId} is completed, but its linked worker ${candidate.terminalId} is still open.`,
    `Verify the result first. If a real follow-up needs this worker, return ${candidate.taskId} to blocked with dependentOn="another-agent" and a specific blockedReason.`,
    "If none remains, send /close to that worker with AgentSend, read its improvements.md record, import measured timing, then AgentClose with the linked terminalId and monitorId.",
    "No worker action was taken. A worker status or signal is not acceptance.",
  ].join("\n");
}

/**
 * Add a one-shot cleanup advisory to a completed delegate task's normal TodoUpdate result.
 * It is advisory only: no command, interrupt, close, status change, or worker registry.
 */
export function registerCleanupAdvisory(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "TodoUpdate" || event.isError || !hasMainWork(pi)) return;
    const candidate = candidateFromDetails(event.details);
    if (!candidate) return;
    const owned = await ownsOpenWorker({
      terminalId: candidate.terminalId,
      taskId: candidate.taskId,
      sessionId: ctx.sessionManager.getSessionId(),
      cwd: ctx.cwd,
    });
    if (!owned) return;

    const text = advisoryText(candidate);
    const details = object(event.details);
    const originalSummary = typeof details?.summary === "string" && details.summary ? details.summary : undefined;
    return {
      content: event.content.map((part) => part.type === "text" ? { ...part, text: `${part.text}\n\n${text}` } : part),
      details: {
        ...(details ?? {}),
        summary: originalSummary === undefined ? text : `${originalSummary}\n\n${text}`,
        data: { ...object(details?.data), cleanupAdvisory: true },
      },
    };
  });
}
