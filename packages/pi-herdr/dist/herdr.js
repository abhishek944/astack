import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export const TERMINAL_ID = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?t[0-9a-z]+$/;
export function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export async function cliText(command, args, cwd, signal, timeout = 15_000) {
    // App commands target the normal desktop instance, not an inherited test fixture.
    const env = command === "herdr-app" ? { ...process.env } : undefined;
    if (env)
        delete env.HERDR_APP_HOME;
    const { stdout } = await execFileAsync(command, args, { cwd, env, signal, timeout, maxBuffer: 1024 * 1024, windowsHide: true });
    return stdout;
}
export async function hc(args, cwd, signal, timeout) {
    const [command, ...rest] = args;
    if (!command)
        throw new Error("An hc command is required.");
    return cliJson("hc", [command, "--json", ...rest], cwd, signal, timeout);
}
export async function app(args, cwd, signal) {
    return cliJson("herdr-app", args, cwd, signal);
}
async function cliJson(command, args, cwd, signal, timeout) {
    const response = object(JSON.parse(await cliText(command, args, cwd, signal, timeout)));
    if (typeof response?.error === "string")
        throw new Error(response.error);
    const error = object(response?.error);
    if (error)
        throw new Error(typeof error.message === "string" ? error.message : `${command} command failed.`);
    if (!response)
        throw new Error(`${command} returned no object.`);
    return response;
}
/**
 * Verify and name the app tab that adopted a presented worker. Optional presentation only:
 * a Core-only worker never calls this, and the caller owns a failure here.
 */
export async function nameWorkerTab(input) {
    const tab = terminalTab(await app(["ls"], input.cwd, input.signal), input.terminalId);
    if (!tab || tab.spaceId !== input.spaceId || tab.tabId === input.parentTabId || tab.terminalCount !== 1)
        throw new Error("The presented Core terminal has not appeared in its own dedicated app tab. Inspect the returned terminal; do not relaunch blindly.");
    await app(["do", "tab.rename", JSON.stringify({ id: tab.tabId, name: input.taskId })], input.cwd, input.signal);
    const verified = terminalTab(await app(["ls"], input.cwd, input.signal), input.terminalId);
    if (verified?.tabId !== tab.tabId || verified.name !== input.taskId || verified.terminalCount !== 1)
        throw new Error("The presented task-named worker tab could not be verified.");
    return tab.tabId;
}
export function terminalTab(inventory, terminalId) {
    for (const rawSpace of Array.isArray(inventory.spaces) ? inventory.spaces : []) {
        const space = object(rawSpace);
        if (typeof space?.id !== "string")
            continue;
        for (const rawTab of Array.isArray(space.tabs) ? space.tabs : []) {
            const tab = object(rawTab);
            const terminals = Array.isArray(tab?.terminals) ? tab.terminals : [];
            if (typeof tab?.id === "string" && terminals.some((value) => object(value)?.terminal === terminalId)) {
                return { spaceId: space.id, tabId: tab.id, name: typeof tab.name === "string" ? tab.name : "", terminalCount: terminals.length };
            }
        }
    }
    return undefined;
}
