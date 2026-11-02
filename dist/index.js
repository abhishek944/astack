import { registerDelegationBridge } from "./agents/delegation.js";
import { delegateLink, focusTerminal } from "./agents/links.js";
import { registerTaskAutoContinue } from "./auto-continue.js";
import { registerWorksCommand } from "./command.js";
import { registerDelegatedTimeTools } from "./delegated-time.js";
import { GitStatusCache } from "./git-status.js";
import { setHerdrTasksPaneVisible } from "./herdr-panel.js";
import { openRepository, openSession, readOpenCommand } from "./open-repository.js";
import { readPanelSettings } from "./panel-settings.js";
import { TaskState } from "./state.js";
import { safeSingleLine } from "./text.js";
import { registerTaskTiming } from "./timing.js";
import { registerTaskTools } from "./tools.js";
import { registerTrackingGuidance } from "./tracking.js";
import { TasksPanelHost } from "./ui/panel.js";
export default function tasksExtension(pi) {
    let panel;
    const state = new TaskState(pi, () => panel?.update());
    const git = new GitStatusCache();
    const getSettings = () => pi.getSettings?.();
    const getOpenCommand = () => readOpenCommand(getSettings());
    let visibleMode = "floating";
    panel = new TasksPanelHost(state, git, getOpenCommand);
    registerTaskTools(pi, state);
    registerDelegatedTimeTools(pi, state);
    registerTaskTiming(pi, state);
    registerDelegationBridge(pi, state);
    registerTrackingGuidance(pi);
    registerTaskAutoContinue(pi, state);
    registerWorksCommand(pi, state, git, getOpenCommand, async (requested, ctx) => {
        if (requested === "herdr-on" || requested === "herdr-off") {
            try {
                const visible = requested === "herdr-on";
                await setHerdrTasksPaneVisible(ctx, visible, visible ? state.snapshotPath : "", visible ? getOpenCommand() : undefined);
                ctx.ui.notify(visible ? "Opened the Herdr Tasks pane." : "Closed this session’s Herdr Tasks pane.", "info");
            }
            catch (error) {
                ctx.ui.notify(error instanceof Error ? safeSingleLine(error.message) : "Could not change the Herdr Tasks pane visibility.", "error");
            }
            return;
        }
        const delegateTask = /^delegate\s+(T\d+)$/.exec(requested)?.[1];
        if (delegateTask) {
            const todo = state.getTodo(delegateTask);
            const link = todo ? delegateLink(todo.taskInfo) : undefined;
            if (!link) {
                ctx.ui.notify("This task has no valid Core delegate terminal link.", "warning");
                return;
            }
            try {
                await focusTerminal(link.terminalId, ctx.cwd);
                ctx.ui.notify("Opened delegated agent in Herdr.", "info");
            }
            catch (error) {
                const reason = error instanceof Error ? safeSingleLine(error.message) : "Unknown error.";
                ctx.ui.notify(`Could not open delegate. ${reason}`, "error");
            }
            return;
        }
        if (requested === "open" || requested === "open-session") {
            try {
                const command = getOpenCommand();
                if (requested === "open-session")
                    await openSession(ctx.cwd, ctx.sessionManager.getSessionId(), command);
                else
                    await openRepository(ctx.cwd, command);
                ctx.ui.notify(requested === "open-session" ? "Opened session artifacts." : "Opened repository.", "info");
            }
            catch (error) {
                const reason = error instanceof Error ? ` ${safeSingleLine(error.message)}` : "";
                ctx.ui.notify(`Could not open directory. Check pi-tasks.openCommand and that its executable is installed on PATH.${reason}`, "error");
            }
            return;
        }
        if (requested === "minimize" || requested === "maximize") {
            panel?.setMinimized(requested === "minimize");
            ctx.ui.notify(`Works panel: ${requested}d`, "info");
            return;
        }
        const mode = requested === "compact-on" ? visibleMode : requested === "compact-off" ? "off" : requested === "floating" || requested === "widget" ? requested : undefined;
        if (!mode) {
            ctx.ui.notify("Usage: /works [compact-on|compact-off|herdr-on|herdr-off|floating|widget|minimize|maximize|open|open-session] or /works delegate T<number>", "info");
            return;
        }
        if (mode !== "off")
            visibleMode = mode;
        panel?.setMode(mode);
        ctx.ui.notify(`Works compact display: ${mode}`, "info");
    });
    pi.on("session_start", (event, ctx) => {
        state.restore(ctx, event.reason === "fork");
        git.setCwd(ctx.cwd);
        try {
            const settings = readPanelSettings(getSettings());
            visibleMode = settings.mode;
            panel?.setMode(settings.enabled ? visibleMode : "off");
        }
        catch (error) {
            panel?.setMode("off");
            ctx.ui.notify(error instanceof Error ? error.message : "Invalid task panel settings.", "error");
        }
        if (ctx.mode === "tui")
            panel?.attach(ctx.ui, ctx.cwd, ctx.sessionManager.getSessionId());
    });
    pi.on("tool_result", (event) => {
        if (event.toolName === "write" || event.toolName === "edit" || event.toolName === "bash")
            git.invalidate();
    });
    pi.on("session_shutdown", () => {
        panel?.hide();
        git.dispose();
    });
}
