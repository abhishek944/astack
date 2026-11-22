/**
 * Install the Routing mod, its bar button in Herdr's top row, and its content in
 * the existing native Files/Changes right-panel stack.
 *
 * Nothing here starts a process in the app: the panel is a mod copy Herdr draws
 * when its stack entry is selected, and every write it makes happens when the
 * person presses Save.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { herdrAppHome, layoutsDirectory, modDirectory, sharedPath } from "./paths.js";
/** Herdr replaces these on every start, so a structural edit there cannot survive. */
const SHIPPED_LAYOUTS = new Set(["main", "terminals", "win98"]);
const MOD = "pi-routing";
const BAR = "routing-bar";
const PANEL = "routing";
/**
 * The bar slot, exact to its content. Routing sits directly after the tab bar,
 * whose own buttons are 21.5 px apart; this slot plus the button paddings in
 * `main.js` give the same 21.5 px on both sides, so every item in the row is
 * evenly spaced. A wider slot would lengthen the gap on its right.
 */
const BAR_PX = 67;
export async function sourceDirectory() {
    return fileURLToPath(new URL("../../herdr/pi-routing/", import.meta.url));
}
/** Herdr writes these into a mod folder itself; never ship a stale copy. */
const GENERATED = new Set(["jsconfig.json"]);
/** Records what this installer owns, so a later version can prune removed files. */
const MANIFEST = "pi-routing-assets.json";
async function listFiles(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    const assets = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            assets.push(...(await listFiles(join(directory, entry.name), relative)));
            continue;
        }
        if (!entry.isFile())
            continue;
        if (GENERATED.has(entry.name) || entry.name.endsWith(".d.ts"))
            continue;
        assets.push({ relative, contents: await readFile(join(directory, entry.name)) });
    }
    return assets;
}
function* walk(node) {
    yield node;
    for (const child of node.children ?? [])
        yield* walk(child);
}
export function hasRoutingBar(root) {
    for (const node of walk(root)) {
        if (node.content?.mod === MOD && node.content?.props?.slot === "bar")
            return true;
    }
    return false;
}
/** Add a choice to the native panel, never a separate pane or floating fallback. */
export function patchLayout(root) {
    const panel = [...walk(root)].find((node) => node.id === "panel");
    const body = panel?.children?.find((node) => node.id === "panel-body" && node.type === "stack");
    if (!body || !["files", "changes"].every((id) => body.children?.some((node) => node.id === id && node.content?.mod === id))) {
        return { root, changed: false, note: "this layout has no native Files/Changes panel-body stack; nothing was changed" };
    }
    const existing = [...walk(root)].find((node) => node.id === PANEL);
    if (existing && (!body.children?.includes(existing) || existing.content?.mod !== MOD || existing.content.props?.slot !== "panel")) {
        return { root, changed: false, note: `the ${PANEL} node id is already used by other content; nothing was changed` };
    }
    const notes = [];
    let changed = false;
    if (!existing) {
        body.children = [...(body.children ?? []), { id: PANEL, type: "block", content: { mod: MOD, props: { slot: "panel" } } }];
        changed = true;
        notes.push("added Routing to the native right panel");
    }
    // The one place the button belongs: directly after the tabs, before any other
    // bar. A neighbour's unused slot width then cannot push it out of line with
    // the buttons it joins, and its own slot is only as wide as it needs.
    const hosts = [];
    for (const node of walk(root)) {
        if (node.type !== "row")
            continue;
        const tabs = node.children?.find((child) => child.content?.mod === "tabs");
        if (tabs)
            hosts.push({ row: node, tabs });
    }
    const host = hosts[0];
    if (!host)
        return { root, changed, note: notes.join(" and ") || "this layout has no tab bar to sit beside; nothing was changed" };
    const bars = [...walk(root)].filter((node) => node.content?.mod === MOD && node.content?.props?.slot === "bar");
    const placed = (host.row.children ?? []).indexOf(host.tabs) + 1;
    if (bars.length === 1 && (host.row.children ?? [])[placed] === bars[0]) {
        const only = bars[0];
        if (only && only.size?.px !== BAR_PX) {
            only.size = { px: BAR_PX };
            changed = true;
            notes.push(`set the Routing slot to ${BAR_PX} px`);
        }
        return { root, changed, note: notes.join(" and ") };
    }
    const bar = {
        id: BAR,
        type: "block",
        size: { px: BAR_PX },
        content: { mod: MOD, props: { slot: "bar" } },
    };
    for (const node of walk(root)) {
        if (node.children)
            node.children = node.children.filter((child) => !bars.includes(child) && child.id !== BAR);
    }
    const children = [...(host.row.children ?? [])];
    const at = children.indexOf(host.tabs) + 1;
    children.splice(at, 0, bar);
    host.row.children = children;
    changed = true;
    notes.push(bars.length > 0 ? "moved Routing beside the tabs" : "added Routing beside the tab bar");
    return { root, changed, note: notes.join(" and ") };
}
async function activeLayout(env) {
    try {
        const shared = JSON.parse(await readFile(sharedPath(env), "utf8"));
        if (typeof shared.layout === "string" && shared.layout.trim())
            return shared.layout.trim();
    }
    catch {
        // No shared.json yet: fall back to the shipped layout name.
    }
    return "main";
}
async function checkMod(directory) {
    return new Promise((resolve) => {
        const child = spawn("herdr-app", ["check", directory], { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        const finish = (ran, ok) => resolve({ ran, ok, output: output.trim() });
        const timer = setTimeout(() => {
            child.kill();
            finish(true, false);
        }, 60_000);
        child.stdout.on("data", (chunk) => {
            output += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            output += chunk.toString("utf8");
        });
        child.on("error", () => {
            clearTimeout(timer);
            finish(false, false);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            finish(true, code === 0);
        });
    });
}
/** Delete files a previous install owned that this version no longer ships. */
async function pruneRemoved(target, shipped) {
    const removed = [];
    let previous = null;
    try {
        previous = JSON.parse(await readFile(join(target, MANIFEST), "utf8"));
    }
    catch {
        previous = null;
    }
    const files = previous?.files;
    if (!Array.isArray(files))
        return removed;
    for (const entry of files) {
        if (typeof entry !== "string" || entry.startsWith("/") || entry.includes("..") || shipped.has(entry))
            continue;
        try {
            await unlink(join(target, entry));
            removed.push(entry);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
    return removed;
}
export async function installRouting(options = {}) {
    const home = herdrAppHome(options);
    try {
        const info = await stat(home);
        if (!info.isDirectory())
            throw new Error("not a directory");
    }
    catch {
        throw new Error(`No Herdr app home at ${home}. Install Herdr first, or set HERDR_APP_HOME.`);
    }
    const source = await sourceDirectory();
    const assets = await listFiles(source);
    if (assets.length === 0)
        throw new Error(`The package is missing its mod assets at ${source}.`);
    // Resolve the same package and Node host at install time, not a possibly unrelated PATH command.
    assets.push({
        relative: "host.json",
        contents: Buffer.from(`${JSON.stringify({ command: process.execPath, args: [fileURLToPath(new URL("../../bin/pi-routing.js", import.meta.url))] })}\n`),
    });
    const target = modDirectory(options);
    const shipped = new Set(assets.map((asset) => asset.relative));
    const removed = await pruneRemoved(target, shipped);
    const written = [];
    const identical = [];
    const drifted = [];
    for (const asset of assets) {
        const destination = join(target, asset.relative);
        await mkdir(dirname(destination), { recursive: true });
        let current = null;
        try {
            current = await readFile(destination);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        if (current === null) {
            await writeFile(destination, asset.contents, { flag: "wx" });
            written.push(asset.relative);
            continue;
        }
        if (current.equals(asset.contents)) {
            identical.push(asset.relative);
            continue;
        }
        if (options.force) {
            await writeFile(destination, asset.contents);
            written.push(asset.relative);
            continue;
        }
        drifted.push(asset.relative);
    }
    const name = options.layout?.trim() || (await activeLayout(options));
    const layoutPath = join(layoutsDirectory(options), `${name}.json`);
    let layoutReport = { name, path: null, backup: null, changed: false, note: "" };
    let raw = null;
    try {
        raw = await readFile(layoutPath, "utf8");
    }
    catch {
        raw = null;
    }
    if (raw === null) {
        layoutReport = { name, path: layoutPath, backup: null, changed: false, note: "no such layout file; the mod is installed but not shown" };
    }
    else {
        let tree;
        try {
            tree = JSON.parse(raw);
        }
        catch {
            throw new Error(`The layout ${layoutPath} is not valid JSON.`);
        }
        const shippedLayout = SHIPPED_LAYOUTS.has(name) && typeof tree.cloned_from !== "object";
        if (shippedLayout) {
            layoutReport = {
                name,
                path: layoutPath,
                backup: null,
                changed: false,
                note: `Herdr owns the shipped ${name} layout and replaces it on every start. Clone it first (herdr-app do layout.clone '{"name":"${name}","as":"my-layout"}') and install into the clone with --layout.`,
            };
        }
        else {
            const patched = patchLayout(tree);
            if (!patched.changed) {
                layoutReport = { name, path: layoutPath, backup: null, changed: false, note: patched.note };
            }
            else {
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                const backup = `${layoutPath}.bak-${stamp}`;
                await writeFile(backup, raw, "utf8");
                await writeFile(layoutPath, `${JSON.stringify(patched.root, null, 2)}\n`, "utf8");
                layoutReport = { name, path: layoutPath, backup, changed: true, note: patched.note };
            }
        }
    }
    const check = options.skipCheck ? { ran: false, ok: false, output: "skipped" } : await checkMod(target);
    await writeFile(join(target, MANIFEST), `${JSON.stringify({ files: [...shipped].sort() }, null, 2)}\n`, "utf8");
    return { appHome: home, modDirectory: target, written, identical, drifted, removed, layout: layoutReport, check };
}
