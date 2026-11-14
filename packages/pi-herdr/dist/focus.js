import { app, hc, object, TERMINAL_ID } from "./herdr.js";
/**
 * App-only presentation. An unavailable desktop is reported, never fatal to the
 * Core terminal.
 *
 * `agent.focus` cannot show a pane-less sub-agent: the app acknowledges it and
 * changes nothing. The app's own listing separates a pane owner from a child
 * listed under its parent, so use `terminal.peek` for the child screen overlay.
 * The listing nests only one child level; a deeper live child has no listing
 * entry and is recognized by its nonempty Core parent. Another machine's
 * terminal is handled by the app's own focus path.
 */
export async function focusTerminal(terminalId, cwd, signal) {
    if (!TERMINAL_ID.test(terminalId))
        throw new Error("Use the terminalId returned by hc.");
    try {
        const presentation = await presentationRoute(terminalId, cwd, signal);
        await app(["do", presentation === "peek" ? "terminal.peek" : "agent.focus", JSON.stringify({ terminal: terminalId })], cwd, signal);
        return { focused: true, presentation };
    }
    catch (error) {
        return { focused: false, reason: `Herdr app could not show this agent: ${error instanceof Error ? error.message : String(error)}` };
    }
}
async function presentationRoute(terminalId, cwd, signal) {
    if (terminalId.includes("/"))
        return "focus";
    const inventory = await app(["ls"], cwd, signal);
    let listedChild = false;
    for (const rawSpace of Array.isArray(inventory.spaces) ? inventory.spaces : []) {
        const space = object(rawSpace);
        for (const rawTab of Array.isArray(space?.tabs) ? space.tabs : []) {
            const tab = object(rawTab);
            for (const rawTerminal of Array.isArray(tab?.terminals) ? tab.terminals : []) {
                const terminal = object(rawTerminal);
                if (terminal?.terminal === terminalId)
                    return "focus";
                if (Array.isArray(terminal?.sub_agents) && terminal.sub_agents.includes(terminalId))
                    listedChild = true;
            }
        }
    }
    if (listedChild)
        return "peek";
    const record = await hc(["get", terminalId], cwd, signal);
    if (typeof record.parent === "string" && record.parent.trim())
        return "peek";
    throw new Error("Herdr is not showing this agent. Open its space, then retry.");
}
