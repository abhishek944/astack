import { createTimingReport } from "../delegated-time.js";
import { taskOwner } from "../ownership.js";
import { areTrackingToolsActive } from "../tracking.js";
import { TERMINAL_ID } from "./herdr.js";
import { delegateLink, withTerminalLink } from "./links.js";
/** Task-owned state changes used by pi-herdr's lifecycle tools. */
export function registerDelegationBridge(pi, state) {
    let current;
    pi.on("session_start", (_event, ctx) => { current = { sessionId: ctx.sessionManager.getSessionId() }; });
    pi.on("session_shutdown", () => { current = undefined; });
    pi.events.on("pi-tasks:delegation-api", (data) => {
        const request = data;
        if (request?.version !== 1 || typeof request.respond !== "function" || !current)
            return;
        const binding = current;
        const requireCurrent = (ctx) => {
            if (current !== binding || ctx.sessionManager.getSessionId() !== binding.sessionId)
                throw new Error("The pi-tasks delegation bridge belongs to a replaced session. Discover it again from the current session.");
            if (!areTrackingToolsActive(pi))
                throw new Error("Use agent tools in tracked main-conversation work, not /ask or /btw.");
        };
        const assignment = (ctx, input) => {
            requireCurrent(ctx);
            const todo = state.getTodo(input.taskId);
            if (!todo || todo.workId !== input.workId || !state.listWorks({ workId: input.workId }).length || taskOwner(todo.taskInfo) !== "delegate")
                throw new Error("Use an existing task in this work with owner: delegate.");
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
                if (!TERMINAL_ID.test(input.terminalId))
                    throw new Error("Use the terminalId returned by hc.");
                state.setDelegatedTime(input.taskId, { reportPath: input.reportPath, elapsedMs: null });
                state.updateTodo(input.taskId, { status: "blocked", blockedReason: "Waiting for the delegated agent. Resume when its output is available for inspection and verification.", taskInfo: withTerminalLink(todo.taskInfo, input.terminalId, input.monitorId) });
            },
            detach(ctx, input) {
                requireCurrent(ctx);
                if (!TERMINAL_ID.test(input.terminalId))
                    throw new Error("Use the terminalId returned by hc.");
                for (const todo of state.listTodos())
                    if (delegateLink(todo.taskInfo)?.terminalId === input.terminalId)
                        state.updateTodo(todo.taskId, { taskInfo: withTerminalLink(todo.taskInfo) });
            },
        });
    });
}
