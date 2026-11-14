/**
 * Install the scheduler mod, its persistent top-bar slot, and its content in
 * the existing native Files/Changes right-panel stack.
 *
 * Nothing here starts anything. The mod starts its own clock when the window
 * first shows it, which is what makes the scheduler app-open-only without a
 * service, a login item or a supervisor.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyState, parseState, parseTask, serializeState, serializeTask, type Task, type TaskState } from "../core/model.js";
import {
  claimsDirectory,
  herdrAppHome,
  layoutsDirectory,
  locksDirectory,
  modDirectory,
  schedulerDirectory,
  sharedPath,
  statePath,
  statesDirectory,
  taskPath,
  tasksDirectory,
} from "./paths.js";
import { withTaskLock } from "./store.js";

/** Herdr replaces these on every start, so a structural edit there cannot survive. */
const SHIPPED_LAYOUTS = new Set(["main", "terminals", "win98"]);

export interface LayoutNode {
  id?: string;
  type?: string;
  content?: { mod?: string; props?: Record<string, unknown> };
  children?: LayoutNode[];
  size?: unknown;
  window_drag?: boolean;
  [key: string]: unknown;
}

export interface InstallAsset {
  relative: string;
  contents: Buffer;
}

export interface InstallOptions {
  env?: NodeJS.ProcessEnv;
  layout?: string;
  force?: boolean;
  /** Skip the `herdr-app check` load test. */
  skipCheck?: boolean;
}

export interface Migration { tasks: number; problems: string[]; keptAt: string | null }

/** The first build kept one document at `state.json`; move its tasks into per-task files once. */
async function migrateLegacyStore(env: NodeJS.ProcessEnv): Promise<Migration> {
  const legacy = join(schedulerDirectory(env), "state.json");
  let raw: string;
  try {
    raw = await readFile(legacy, "utf8");
  } catch {
    return { tasks: 0, problems: [], keptAt: null };
  }
  const result: Migration = { tasks: 0, problems: [], keptAt: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    result.problems.push("state.json is not valid JSON; left in place");
    return result;
  }
  const tasks = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) {
    result.problems.push("state.json has no task list; left in place");
    return result;
  }
  for (const entry of tasks) {
    const record = entry as { task?: unknown; state?: unknown };
    const parsedTask = parseTask(record.task);
    if ("error" in parsedTask) {
      result.problems.push(parsedTask.error);
      continue;
    }
    const task: Task = parsedTask.task;
    const parsedState = parseState(record.state ?? {});
    const state: TaskState = "state" in parsedState ? parsedState.state : emptyState();
    await withTaskLock(env, task.id, async () => {
      try {
        await writeFile(taskPath(task.id, env), serializeTask(task), { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          result.problems.push(`${task.id}: a task file already exists; kept it`);
          return;
        }
        throw error;
      }
      await writeFile(statePath(task.id, env), serializeState(state), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      result.tasks += 1;
    });
  }
  const keptAt = `${legacy}.migrated-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await rename(legacy, keptAt);
  result.keptAt = keptAt;
  return result;
}

export interface InstallReport {
  appHome: string;
  modDirectory: string;
  written: string[];
  identical: string[];
  drifted: string[];
  removed: string[];
  layout: { name: string; path: string | null; backup: string | null; changed: boolean; note: string };
  check: { ran: boolean; ok: boolean; output: string };
  migration: Migration;
}

export async function sourceDirectory(): Promise<string> {
  return fileURLToPath(new URL("../../herdr/pi-schedulers/", import.meta.url));
}

/** Herdr writes these into a mod folder itself; never ship a stale copy. */
const GENERATED = new Set(["jsconfig.json"]);

/** Records what this installer owns, so a later version can prune removed files. */
const MANIFEST = "pi-schedulers-assets.json";

async function listFiles(directory: string, prefix = ""): Promise<InstallAsset[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const assets: InstallAsset[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      assets.push(...(await listFiles(join(directory, entry.name), relative)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (GENERATED.has(entry.name) || entry.name.endsWith(".d.ts")) continue;
    assets.push({ relative, contents: await readFile(join(directory, entry.name)) });
  }
  return assets;
}

/** The block that makes the mod visible; its absence is why the mod never starts. */
export function hasSchedulersBar(root: LayoutNode): boolean {
  for (const node of walk(root)) {
    if (node.content?.mod === "pi-schedulers" && node.content?.props?.slot === "bar") return true;
  }
  return false;
}

function* walk(node: LayoutNode): Generator<LayoutNode> {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

/** Add a choice to the native panel, never a separate pane or floating fallback. */
export function patchLayout(root: LayoutNode): { root: LayoutNode; changed: boolean; note: string } {
  const nodes = [...walk(root)];
  const panel = nodes.find((node) => node.id === "panel");
  const body = panel?.children?.find((node) => node.id === "panel-body" && node.type === "stack");
  if (!body || !["files", "changes"].every((id) => body.children?.some((node) => node.id === id && node.content?.mod === id))) {
    return { root, changed: false, note: "this layout has no native Files/Changes panel-body stack; nothing was changed" };
  }
  const existing = nodes.find((node) => node.id === "schedulers");
  if (existing && (!body.children?.includes(existing) || existing.content?.mod !== "pi-schedulers" || existing.content.props?.slot !== "panel")) {
    return { root, changed: false, note: "the schedulers node id is already used by other content; nothing was changed" };
  }
  const hosts: { parent: LayoutNode; index: number; node: LayoutNode }[] = [];
  for (const node of nodes) {
    node.children?.forEach((child, index) => {
      if (child.content?.mod === "tabs") hosts.push({ parent: node, index, node: child });
    });
  }
  const host = hosts[0];
  const barInstalled = hasSchedulersBar(root);
  if (!barInstalled && !host) return { root, changed: false, note: "this layout has no tab bar to sit beside; nothing was changed" };
  if (barInstalled && existing) return { root, changed: false, note: "already installed in the native right panel" };
  if (!existing) {
    body.children = [...(body.children ?? []), {
      id: "schedulers",
      type: "block",
      content: { mod: "pi-schedulers", props: { slot: "panel" } },
    }];
  }
  if (!barInstalled && host) {
    const bar: LayoutNode = {
      id: "schedulers-bar",
      type: "block",
      size: { px: 128 },
      content: { mod: "pi-schedulers", props: { slot: "bar" } },
    };
    const children = [...(host.parent.children ?? [])];
    if (host.parent.type === "row") {
      children.splice(host.index + 1, 0, bar);
    } else {
      const row: LayoutNode = {
        id: "top-bar",
        type: "row",
        size: host.node.size ?? { px: 42 },
        children: [{ ...host.node, size: { weight: 1 } }, bar],
      };
      if (host.node.window_drag) row.window_drag = true;
      children[host.index] = row;
    }
    host.parent.children = children;
  }
  return { root, changed: true, note: "added Schedulers to the native right panel and retained the persistent top bar" };
}

async function activeLayout(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const shared = JSON.parse(await readFile(sharedPath(env), "utf8")) as { layout?: unknown };
    if (typeof shared.layout === "string" && shared.layout.trim()) return shared.layout.trim();
  } catch {
    // No shared.json yet: fall back to the shipped layout name.
  }
  return "main";
}

async function checkMod(directory: string): Promise<{ ran: boolean; ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("herdr-app", ["check", directory], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const finish = (ran: boolean, ok: boolean) => resolve({ ran, ok, output: output.trim() });
    const timer = setTimeout(() => {
      child.kill();
      finish(true, false);
    }, 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
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

/**
 * Delete files a previous install owned that this version no longer ships.
 *
 * `core/` is generated entirely by this installer, so it is swept: an older
 * build's module that no longer exists must not linger next to the new ones.
 * Everything else comes from the previous manifest, so a personal file is never
 * touched.
 */
async function pruneRemoved(target: string, shipped: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  const drop = async (entry: string) => {
    if (entry.startsWith("/") || entry.includes("..") || shipped.has(entry)) return;
    try {
      await unlink(join(target, entry));
      removed.push(entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };

  let previous: unknown = null;
  try {
    previous = JSON.parse(await readFile(join(target, MANIFEST), "utf8"));
  } catch {
    previous = null;
  }
  const files = (previous as { files?: unknown } | null)?.files;
  if (Array.isArray(files)) {
    for (const entry of files) if (typeof entry === "string") await drop(entry);
  }

  try {
    for (const entry of await readdir(join(target, "core"))) {
      if (entry.endsWith(".js") || entry.endsWith(".d.ts")) await drop(`core/${entry}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return removed;
}

export async function installSchedulers(options: InstallOptions = {}): Promise<InstallReport> {
  const env = options.env ?? process.env;
  const appHome = herdrAppHome(env);
  try {
    const info = await stat(appHome);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`No Herdr app home at ${appHome}. Install Herdr first, or set HERDR_APP_HOME.`);
  }

  const source = await sourceDirectory();
  const assets = await listFiles(source);
  if (assets.length === 0) throw new Error(`The package is missing its mod assets at ${source}.`);
  // Resolve the same package and Node host at install time, not a possibly unrelated PATH command.
  assets.push({
    relative: "host.json",
    contents: Buffer.from(`${JSON.stringify({ command: process.execPath, args: [fileURLToPath(new URL("../../bin/pi-schedulers.js", import.meta.url))] })}\n`),
  });

  const target = modDirectory(env);
  const shipped = new Set(assets.map((asset) => asset.relative));
  const removed = await pruneRemoved(target, shipped);
  const written: string[] = [];
  const identical: string[] = [];
  const drifted: string[] = [];
  for (const asset of assets) {
    const destination = join(target, asset.relative);
    await mkdir(dirname(destination), { recursive: true });
    let current: Buffer | null = null;
    try {
      current = await readFile(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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

  for (const directory of [schedulerDirectory(env), tasksDirectory(env), statesDirectory(env), claimsDirectory(env), locksDirectory(env)]) {
    await mkdir(directory, { recursive: true });
  }
  const migrated = await migrateLegacyStore(env);

  const name = options.layout?.trim() || (await activeLayout(env));
  const layoutPath = join(layoutsDirectory(env), `${name}.json`);
  let layoutReport: InstallReport["layout"] = { name, path: null, backup: null, changed: false, note: "" };
  let raw: string | null = null;
  try {
    raw = await readFile(layoutPath, "utf8");
  } catch {
    raw = null;
  }
  if (raw === null) {
    layoutReport = { name, path: layoutPath, backup: null, changed: false, note: "no such layout file; the mod is installed but not shown" };
  } else {
    let tree: LayoutNode;
    try {
      tree = JSON.parse(raw) as LayoutNode;
    } catch {
      throw new Error(`The layout ${layoutPath} is not valid JSON.`);
    }
    const shipped = SHIPPED_LAYOUTS.has(name) && typeof tree.cloned_from !== "object";
    if (shipped) {
      layoutReport = {
        name,
        path: layoutPath,
        backup: null,
        changed: false,
        note: `Herdr owns the shipped ${name} layout and replaces it on every start. Clone it first (herdr-app do layout.clone '{"name":"${name}","as":"my-layout"}') and install into the clone with --layout.`,
      };
    } else {
      const patched = patchLayout(tree);
      if (!patched.changed) {
        layoutReport = { name, path: layoutPath, backup: null, changed: false, note: patched.note };
      } else {
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
  return {
    appHome,
    modDirectory: target,
    written,
    identical,
    drifted,
    removed,
    layout: layoutReport,
    check,
    migration: migrated,
  };
}
