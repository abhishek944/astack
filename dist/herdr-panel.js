import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, hc, object, TERMINAL_ID } from "./agents/herdr.js";
import { ensureHerdrTasksHeader } from "./herdr-header.js";
import { readSnapshot } from "./snapshot.js";
/** Install missing shipped assets only. Never overwrite a personal/customized mod. */
async function installBundledMod(appHome) {
    const assets = await Promise.all(["README.md", "main.js", "mod.json", "spinner.svg"].map(async (name) => ({
        name, contents: await readFile(new URL(`../herdr/pi-tasks/${name}`, import.meta.url)),
    })));
    const directory = join(appHome, "mods", "pi-tasks");
    await mkdir(directory, { recursive: true });
    for (const asset of assets) {
        try {
            await writeFile(join(directory, asset.name), asset.contents, { flag: "wx" });
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
    }
}
/** Public Core document read only. One connection per deliberate opener, no service. */
async function readAppDocument(ctx) {
    return new Promise((resolve, reject) => {
        const child = spawn("hc", ["connect"], { cwd: ctx.cwd, signal: ctx.signal, stdio: ["pipe", "pipe", "pipe"] });
        let output = "";
        const timer = setTimeout(() => finish(new Error("Core pane inventory timed out.")), 10_000);
        let settled = false;
        function finish(error, value) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            if (error)
                reject(error);
            else
                resolve(value);
        }
        child.on("error", (error) => finish(error));
        child.on("close", () => { if (!settled)
            finish(new Error("Core closed before returning its pane inventory.")); });
        child.stdin.on("error", (error) => finish(error));
        child.stderr.resume();
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            output += chunk;
            if (output.length > 2 * 1024 * 1024) {
                finish(new Error("Core pane inventory is too large."));
                return;
            }
            const end = output.indexOf("\n");
            if (end < 0)
                return;
            try {
                const reply = object(JSON.parse(output.slice(0, end)));
                const value = object(object(reply?.result)?.value);
                if (reply?.id !== "activity-pane-read" || !value || reply.error)
                    throw new Error("Core returned no usable pane inventory.");
                finish(undefined, value);
            }
            catch (error) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "activity-pane-read", method: "doc.get", params: { name: "herdr-app" } })}\n`);
    });
}
function blocks(value) {
    const node = object(value);
    if (!node)
        return [];
    return [...(node.type === "block" ? [node] : []), ...(Array.isArray(node.children) ? node.children.flatMap(blocks) : [])];
}
/** Show beside this terminal, or hide only its same-session Tasks mod panes. */
export async function setHerdrTasksPaneVisible(ctx, visible, snapshot, openCommand = ["cursor"]) {
    if (visible && (typeof snapshot !== "string" || !isAbsolute(snapshot))) {
        throw new Error("This Pi instance has no session task snapshot binding. Restart Pi, resume this session, then run /works herdr-on again.");
    }
    if (visible && !readSnapshot(snapshot, ctx.sessionManager.getSessionId())) {
        throw new Error("This session's task snapshot is missing. Restart/resume Pi to initialize session task storage, or restore the missing task file, before opening Herdr Tasks.");
    }
    const terminal = process.env.HC_TERMINAL_ID;
    if (!terminal || !TERMINAL_ID.test(terminal))
        throw new Error("Open this Pi session in Herdr Core before opening its Tasks pane.");
    const current = await hc(["get", terminal], ctx.cwd, ctx.signal);
    if (current.address !== terminal || current.state !== "live")
        throw new Error("The originating Core terminal is not live.");
    const appHome = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "herdr-app");
    const inventory = await app(["ls"], ctx.cwd, ctx.signal);
    const document = await readAppDocument(ctx);
    const sessionId = ctx.sessionManager.getSessionId();
    for (const rawSpace of Array.isArray(inventory.spaces) ? inventory.spaces : []) {
        const space = object(rawSpace);
        for (const rawTab of Array.isArray(space?.tabs) ? space.tabs : []) {
            const tab = object(rawTab);
            for (const rawTerminal of Array.isArray(tab?.terminals) ? tab.terminals : []) {
                const item = object(rawTerminal);
                if (item?.terminal !== terminal || typeof item.pane !== "string")
                    continue;
                if (space?.machine)
                    throw new Error("The file-backed Tasks pane currently supports local Herdr sessions only.");
                const documentSpace = (Array.isArray(document.spaces) ? document.spaces : []).map(object).find((entry) => entry?.id === space?.id);
                const documentTab = (Array.isArray(documentSpace?.tabs) ? documentSpace.tabs : []).map(object).find((entry) => entry?.id === tab?.id);
                const panes = blocks(documentTab?.root);
                if (!panes.some((pane) => pane.id === item.pane && object(pane.content)?.terminal === terminal)) {
                    throw new Error("The source terminal pane changed. Retry opening Tasks from this session.");
                }
                const matches = (pane, mod) => {
                    const content = object(pane.content);
                    const binding = object(content?.props);
                    return typeof pane.id === "string" && content?.terminal == null && content?.mod === mod && binding?.sessionId === sessionId && binding.terminal === terminal;
                };
                const existing = panes.filter((pane) => matches(pane, "pi-tasks"));
                if (!visible) {
                    for (const pane of existing)
                        await app(["do", "pane.close", JSON.stringify({ pane: pane.id })], ctx.cwd, ctx.signal);
                    return;
                }
                if (existing.length) {
                    await app(["do", "pane.focus", JSON.stringify({ pane: existing[0].id })], ctx.cwd, ctx.signal);
                    return;
                }
                const activity = panes.find((pane) => matches(pane, "pi-loop-monitor"));
                await installBundledMod(appHome);
                await ensureHerdrTasksHeader(ctx, appHome);
                const args = ["do", "pane.split", JSON.stringify({ pane: activity?.id ?? item.pane, direction: activity ? "down" : "right", mod: "pi-tasks", props: { sessionId: ctx.sessionManager.getSessionId(), snapshot, terminal, openCommand } })];
                let result;
                try {
                    result = await app(args, ctx.cwd, ctx.signal);
                }
                catch (error) {
                    const failure = object(error);
                    const message = [error instanceof Error ? error.message : "", failure?.stdout, failure?.stderr].filter((part) => typeof part === "string").join("\n");
                    // Herdr discovers new folders asynchronously. This exact rejection
                    // happens before pane creation, so one discovery retry cannot duplicate it.
                    if (!message.includes('no mod "pi-tasks" in mods/') && !message.includes('no mod \\"pi-tasks\\" in mods/'))
                        throw error;
                    await delay(1_000, undefined, { signal: ctx.signal });
                    result = await app(args, ctx.cwd, ctx.signal);
                }
                if (typeof result.pane !== "string")
                    throw new Error("Herdr did not return a Tasks pane ID.");
                return;
            }
        }
    }
    throw new Error("This Pi terminal has no pane in the running Herdr app. Open its terminal tab first.");
}
