import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTimingReport } from "../delegated-time.js";
import { taskOwner } from "../ownership.js";
import type { TaskState } from "../state.js";
import { areTrackingToolsActive } from "../tracking.js";
import { TERMINAL_ID } from "./herdr.js";
import { delegateLink, withTerminalLink } from "./links.js";

// Structural contract duplicated in pi-herdr: no shared runtime module or task store.
interface Assignment { workId: string; taskId: string }
interface DelegationAPI {
  prepare(ctx: ExtensionContext, input: Assignment & { taskDir: string }): Promise<{ reportPath: string }>;
  attach(ctx: ExtensionContext, input: Assignment & { terminalId: string; monitorId: string; reportPath: string }): void;
  detach(ctx: ExtensionContext, input: { terminalId: string }): void;
}
interface Discovery { version: 1; respond(api: DelegationAPI): void }

/** Task-owned state changes used by pi-herdr's lifecycle tools. */
export function registerDelegationBridge(pi: ExtensionAPI, state: TaskState): void {
  let current: { sessionId: string } | undefined;
  pi.on("session_start", (_event, ctx) => { current = { sessionId: ctx.sessionManager.getSessionId() }; });
  pi.on("session_shutdown", () => { current = undefined; });
  pi.events.on("pi-tasks:delegation-api", (data) => {
    const request = data as Partial<Discovery> | null;
    if (request?.version !== 1 || typeof request.respond !== "function" || !current) return;
    const binding = current;
    const requireCurrent = (ctx: ExtensionContext) => {
      if (current !== binding || ctx.sessionManager.getSessionId() !== binding.sessionId) throw new Error("The pi-tasks delegation bridge belongs to a replaced session. Discover it again from the current session.");
      if (!areTrackingToolsActive(pi)) throw new Error("Use agent tools in tracked main-conversation work, not /ask or /btw.");
    };
    const assignment = (ctx: ExtensionContext, input: Assignment) => {
      requireCurrent(ctx);
      const todo = state.getTodo(input.taskId);
      if (!todo || todo.workId !== input.workId || !state.listWorks({ workId: input.workId }).length || taskOwner(todo.taskInfo) !== "delegate") throw new Error("Use an existing task in this work with owner: delegate.");
      return todo;
    };
    request.respond({
      async prepare(ctx, input) {
        assignment(ctx, input);
        const reportPath = await createTimingReport(ctx, input.taskDir, input.workId, input.taskId);
        assignment(ctx, input);
        return { reportPath };
      },
      attach(ctx, input) {
        const todo = assignment(ctx, input);
        if (!TERMINAL_ID.test(input.terminalId)) throw new Error("Use the terminalId returned by hc.");
        state.setDelegatedTime(input.taskId, { reportPath: input.reportPath, elapsedMs: null });
        state.updateTodo(input.taskId, { status: "blocked", blockedReason: "Waiting for the delegated agent. Resume when its output is available for inspection and verification.", taskInfo: withTerminalLink(todo.taskInfo, input.terminalId, input.monitorId) });
      },
      detach(ctx, input) {
        requireCurrent(ctx);
        if (!TERMINAL_ID.test(input.terminalId)) throw new Error("Use the terminalId returned by hc.");
        for (const todo of state.listTodos()) if (delegateLink(todo.taskInfo)?.terminalId === input.terminalId) state.updateTodo(todo.taskId, { taskInfo: withTerminalLink(todo.taskInfo) });
      },
    });
  });
}
