import { taskOwner } from "../ownership.js";
import { app, hc, object, TERMINAL_ID } from "./herdr.js";
export function delegateLink(taskInfo) {
    if (taskOwner(taskInfo) !== "delegate")
        return undefined;
    const terminals = [...taskInfo.matchAll(/^[ \t]*hc-terminal:[ \t]*([^\r\n]*)$/gim)].map((match) => match[1].trim());
    if (terminals.length === 0 || terminals.some((terminal) => !TERMINAL_ID.test(terminal)) || new Set(terminals).size !== 1)
        return undefined;
    return { terminalId: terminals[0] };
}
export async function focusTerminal(terminalId, cwd, signal) {
    if (!TERMINAL_ID.test(terminalId))
        throw new Error("Use the terminalId returned by hc.");
    const presentation = await presentationRoute(terminalId, cwd, signal);
    await app(["do", presentation === "peek" ? "terminal.peek" : "agent.focus", JSON.stringify({ terminal: terminalId })], cwd, signal);
}
/** The same small routing contract as pi-herdr's AgentFocus and the native panel. */
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
export function preservePaneLink(current, next) {
    if (taskOwner(current) !== "delegate" || taskOwner(next) !== "delegate" || /^[ \t]*(?:hc-(?:terminal|monitor)|herdr-(?:pane|monitor)):/im.test(next))
        return next;
    // Preserve historical links as text, but never interpret a TUI pane as a Core terminal.
    const metadata = current.split(/\r?\n/).filter((line) => /^[ \t]*(?:hc-(?:terminal|monitor)|herdr-(?:pane|monitor)):/i.test(line));
    return metadata.length ? `${next.trim()}\n${metadata.join("\n")}` : next;
}
export function withTerminalLink(taskInfo, terminalId, monitorId) {
    const text = taskInfo.split(/\r?\n/).filter((line) => !/^[ \t]*(?:hc-(?:terminal|monitor)|herdr-(?:pane|monitor)):/i.test(line)).join("\n").trim();
    return terminalId ? `${text}\nhc-terminal: ${terminalId}\nhc-monitor: ${monitorId}` : text;
}
