import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { app, object } from "./agents/herdr.js";

const HEADER = "pi-tasks-pane-header";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function frames(value: unknown): Record<string, unknown>[] {
  const node = object(value);
  if (!node) return [];
  const content = object(node.content);
  const pane = content?.tab === "active" ? object(content.pane) : undefined;
  return [...(pane ? [pane] : []), ...(Array.isArray(node.children) ? node.children.flatMap(frames) : [])];
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** The native header belongs to the layout, not the content mod. Preserve originals. */
export async function ensureHerdrTasksHeader(ctx: Pick<ExtensionContext, "cwd" | "signal">, home: string): Promise<void> {
  const status = await app(["status"], ctx.cwd, ctx.signal);
  const name = status.layout;
  if (typeof name !== "string" || !NAME.test(name)) throw new Error("Herdr returned no usable current layout.");
  const current: unknown = JSON.parse(await readFile(join(home, "layouts", `${name}.json`), "utf8"));
  const panes = frames(current);
  if (!panes.length) throw new Error("This Herdr layout has no framed active-tab pane. Use a layout with a visible top pane header for Tasks.");
  const headers = panes.map((pane) => object(pane.header));
  if (headers.some((header) => !header || (header.position ?? "top") !== "top" || header.reveal === "hover")) {
    throw new Error("Tasks needs an always-visible top pane header. This layout has an absent, hidden, or bottom header; it has not been changed.");
  }
  const names = headers.map((header) => object(header?.content)?.mod);
  if (names.every((value) => value === HEADER)) {
    if (headers.some((header) => typeof header?.height !== "number" || header.height < 32)) {
      throw new Error("The personal Tasks header must be at least 32px high. Its layout was preserved; adjust it before opening Tasks.");
    }
    await access(join(home, "mods", HEADER, "main.js"));
    await access(join(home, "mods", HEADER, "base.js"));
    return;
  }
  const source = names[0];
  if (typeof source !== "string" || !NAME.test(source) || names.some((value) => value !== source)) {
    throw new Error("Tasks cannot safely adapt this layout's mixed or unsupported pane headers. Its files have not been changed.");
  }
  const destination = `pi-tasks-${name}`;
  const layoutFile = join(home, "layouts", `${destination}.json`);
  const headerDirectory = join(home, "mods", HEADER);
  if (await exists(layoutFile)) {
    const saved: unknown = JSON.parse(await readFile(layoutFile, "utf8"));
    const savedFrames = frames(saved);
    if (!savedFrames.length || savedFrames.some((pane) => {
      const header = object(pane.header);
      return object(header?.content)?.mod !== HEADER || (header?.position ?? "top") !== "top"
        || header?.reveal === "hover" || typeof header?.height !== "number" || header.height < 32;
    })) {
      throw new Error(`The existing personal ${destination} layout is incompatible with the Tasks top/always/32px header. It was preserved; adjust or rename it before opening Tasks.`);
    }
    await access(join(headerDirectory, "main.js"));
    await access(join(headerDirectory, "base.js"));
    await app(["do", "layout.switch", JSON.stringify({ name: destination })], ctx.cwd, ctx.signal);
    return;
  }
  if (await exists(headerDirectory)) {
    const manifest = object(JSON.parse(await readFile(join(headerDirectory, "mod.json"), "utf8")));
    if (object(manifest?.cloned_from)?.name !== source || !await exists(join(headerDirectory, "base.js"))) {
      throw new Error(`The personal ${HEADER} mod already exists or is incomplete. It was preserved; resolve that conflict before opening Tasks.`);
    }
  } else {
    // Clone commands are structural writes. Never retry an uncertain outcome.
    await app(["do", "mod.clone", JSON.stringify({ name: source, as: HEADER })], ctx.cwd, ctx.signal);
    const base = await readFile(join(headerDirectory, "main.js"));
    await writeFile(join(headerDirectory, "base.js"), base, { flag: "wx" });
    const adapter = await readFile(new URL("../herdr/pi-tasks/header.js", import.meta.url));
    await writeFile(join(headerDirectory, "main.js"), adapter);
    const manifest = object(JSON.parse(await readFile(join(headerDirectory, "mod.json"), "utf8")));
    if (!manifest) throw new Error("The cloned header manifest is invalid; its original files remain intact.");
    await writeFile(join(headerDirectory, "mod.json"), `${JSON.stringify({ ...manifest, pi_activity_header: 1 }, null, 2)}\n`);
  }
  await app(["do", "layout.clone", JSON.stringify({ name, as: destination })], ctx.cwd, ctx.signal);
  const clone: unknown = JSON.parse(await readFile(layoutFile, "utf8"));
  for (const pane of frames(clone)) {
    const header = object(pane.header);
    const content = object(header?.content);
    if (!header || !content || content.mod !== source) throw new Error("The new layout's pane header changed during setup. Its original layout remains intact.");
    content.mod = HEADER;
    // The existing 30px host header needs 32px for the requested close hit target.
    header.height = Math.max(typeof header.height === "number" ? header.height : 30, 32);
  }
  await app(["do", "layout.set", JSON.stringify({ layout: clone })], ctx.cwd, ctx.signal);
}
