// pi-schedulers: scheduled Pi runs that live and die with the Herdr app.
//
// One class, two roles chosen by `props().slot`:
//   bar       the always-shown block in the top row beside Files and Changes.
//             It is the only owner of the clock and dispatch.
//   panel     the native right-panel choice: list, authoring, actions, results.
//             Task actions share the dispatcher's per-task transaction lock.
//             Editor fields use ./core/model.js, the same validation boundary
//             the CLI and the Pi extension use.
//
// Why the bar owns everything: Herdr evaluates a mod's module once per loaded
// copy, so `let runtime` is not shared between the bar and a panel copy.
// Making the bar the only owner is therefore the only single-scheduler rule
// that holds, and it also keeps a UI copy from recovering a live dispatch.
//
// Runs are adopted into a "Schedulers" space with one tab per run through
// `hc run` and Herdr's own `herdr.space` / `herdr.tab` labels.
import { mkdir, readdir, unlink } from "fs/promises";
import { View, div, svg } from "gpui-kit";
import { Button, Switch, h_flex, Input, InputState, Textarea, TextareaState, v_flex } from "gpui-base";
import {
  appHome,
  closeOverlay,
  exec,
  hc,
  home,
  layout,
  notify,
  pickFolder,
  props,
  readTextFile,
  run,
  setShared,
  shared,
  spaces,
  theme,
  writeTextFile,
} from "herdr";
import {
  buildTask,
  DEFAULT_TOOLS,
  emptyState,
  MIN_PI_VERSION,
  parseState,
  parseTask,
  serializeState,
  serializeTask,
  THINKING_LEVELS,
} from "./core/model.js";
import { effectiveWeekdays, formatInstant, scheduleFromDraft, scheduleLabel, TICK_MS, weekdayNames } from "./core/schedule.js";
import {
  beginRun,
  dueInstant,
  failRun,
  finishRun,
  planDue,
  reconcileState,
  reaimMissed,
  requestRun,
  setEnabledState,
  stateAfterEdit,
} from "./core/transitions.js";
import {
  buildAdoptionArgs,
  buildPiArgv,
  newRunId,
  newTabId,
  repoName,
  runTabName,
  runTerminalName,
  SCHEDULERS_SPACE,
  worktreeBranch,
  worktreePath,
} from "./core/run.js";

import { Dropdown } from "./dropdown.js";

// ---------------------------------------------------------------- the store

function storeRoot() {
  return `${appHome()}/data/pi-schedulers`;
}

function tasksDir() {
  return `${storeRoot()}/tasks`;
}

function statesDir() {
  return `${storeRoot()}/state`;
}

function locksDir() {
  return `${storeRoot()}/locks`;
}

function taskPath(id) {
  return `${tasksDir()}/${id}.json`;
}

function statePath(id) {
  return `${statesDir()}/${id}.json`;
}

function lockPath(id) {
  return `${locksDir()}/${id}.json`;
}

function parseOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read every task and its run state. One unreadable file is reported and
 * skipped instead of hiding the rest, which is the point of one file per task.
 */
async function readStore() {
  let names;
  try {
    names = await readdir(tasksDir());
  } catch {
    throw new Error("The scheduler store is missing. Run /schedulers install, or pi-schedulers install.");
  }
  const records = [];
  const problems = [];
  const now = Date.now();
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const id = name.slice(0, -".json".length);
    const taskRaw = await readTextFile(`${tasksDir()}/${name}`);
    if (taskRaw == null) continue;
    const parsedTask = parseTask(parseOrNull(taskRaw));
    if (parsedTask.error) {
      problems.push(`${name}: ${parsedTask.error}`);
      continue;
    }
    if (parsedTask.task.id !== id) {
      problems.push(`${name}: the task id does not match its file name.`);
      continue;
    }
    const stateRaw = await readTextFile(`${statesDir()}/${name}`);
    let state = emptyState();
    if (stateRaw != null) {
      const parsedState = parseState(parseOrNull(stateRaw));
      if (parsedState.error) {
        problems.push(`${name}: ${parsedState.error}`);
        continue;
      }
      state = parsedState.state;
    }
    if (await readTextFile(lockPath(id)) != null) problems.push(`${name}: ownership lock present (active or interrupted). It never expires; inspect persistent locks only after all scheduler owners stop.`);
    else if (state.lastRunStatus === "running") problems.push(`${name}: unfinished dispatch; automatic interrupted-owner recovery is unsupported. Inspect acceptance before manual repair.`);
    records.push({ task: parsedTask.task, state: reconcileState(parsedTask.task, state, now), taskRaw, stateRaw });
  }
  return { records, problems };
}

/** Write one task definition. `null` expected bytes means "create only". */
async function writeTaskFile(record) {
  const text = serializeTask(record.task);
  await writeTextFile(taskPath(record.task.id), text, record.taskRaw);
  record.taskRaw = text;
}

/** Only called while holding the task lock. A conflict is never a stale retry. */
async function writeStateFile(record, state) {
  const text = serializeState(state);
  await writeTextFile(statePath(record.task.id), text, record.stateRaw);
  record.state = state;
  record.stateRaw = text;
}

async function readRecord(id) {
  const taskRaw = await readTextFile(taskPath(id));
  if (taskRaw == null) return null;
  const task = parseTask(parseOrNull(taskRaw));
  if (task.error) throw new Error(task.error);
  if (task.task.id !== id) throw new Error("The task id does not match its file name.");
  const stateRaw = await readTextFile(statePath(id));
  const state = parseState(stateRaw == null ? emptyState() : parseOrNull(stateRaw));
  if (state.error) throw new Error(state.error);
  return { task: task.task, state: reconcileState(task.task, state.state, Date.now()), taskRaw, stateRaw };
}

/** Same exclusive-create protocol as Node's flag:'wx'. No timeout or stealing. */
async function withTaskLock(id, action, skipBusy = false) {
  await mkdir(locksDir(), { recursive: true });
  const path = lockPath(id);
  try {
    await writeTextFile(path, `${JSON.stringify({ owner: "herdr-mod", at: Date.now() })}\n`, null);
  } catch (error) {
    if (await readTextFile(path) != null) {
      if (skipBusy) return;
      throw new Error(`Task is busy or has an interrupted owner (${path}). Nothing changed. Retry after dispatch; if it persists, inspect only after all scheduler owners stop.`);
    }
    throw error;
  }
  try {
    return await action();
  } finally {
    await unlink(path);
  }
}

function requireSnapshot(current, expectedRaw) {
  if ((current?.taskRaw ?? null) !== expectedRaw) throw new Error("That task changed or was deleted. Reload before saving again.");
}

async function saveDefinition(task, expectedRaw) {
  await withTaskLock(task.id, async () => {
    const previous = await readRecord(task.id);
    requireSnapshot(previous, expectedRaw);
    // Derive before assigning task: previous must remain the untouched old record.
    const state = stateAfterEdit(previous, task, Date.now());
    const record = { task, state, taskRaw: previous?.taskRaw ?? null, stateRaw: previous?.stateRaw ?? null };
    await writeTaskFile(record);
    if (!previous || serializeState(previous.state) !== serializeState(state)) await writeStateFile(record, state);
  });
}

async function changeDefinition(id, expectedRaw, operation) {
  await withTaskLock(id, async () => {
    const current = await readRecord(id);
    requireSnapshot(current, expectedRaw);
    if (!current) throw new Error("That task was deleted.");
    if (operation === "remove") {
      await removeFiles(id);
      return;
    }
    const now = Date.now();
    if (operation === "run") {
      if (!current.task.enabled) throw new Error("Enable the task before running it.");
      await writeStateFile(current, requestRun(current.state, now));
      return;
    }
    const enabled = operation === "enable";
    const task = { ...current.task, enabled, updatedAt: now };
    const state = setEnabledState(current.state, task, enabled, now);
    const record = { ...current, task };
    await writeTaskFile(record);
    if (serializeState(current.state) !== serializeState(state)) await writeStateFile(record, state);
  });
}

function announceChange() {
  setShared("pi-schedulers.changedAt", Date.now());
}

async function removeFiles(id) {
  for (const path of [taskPath(id), statePath(id)]) {
    if (await readTextFile(path) != null) await unlink(path);
  }
}

// ------------------------------------------------------------- Pi resolution

function atLeast(version, required) {
  for (let index = 0; index < 3; index += 1) {
    const left = version[index] ?? 0;
    const right = required[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * The `pi` a scheduled run would use, plus whether it is new enough for the
 * flags the run depends on. Resolved once per window through the login shell.
 */
async function resolvePi() {
  let binary = "pi";
  try {
    const found = await exec("/bin/sh", ["-lc", "command -v pi"]);
    const path = String(found.stdout ?? "").trim().split("\n").filter(Boolean).pop();
    if (found.code === 0 && path) binary = path;
  } catch {
    // Not on the login shell's PATH this time; try the bare name at launch.
  }
  let version = null;
  try {
    const printed = await exec(binary, ["--version"]);
    if (printed.code === 0) version = parseVersion(printed.stdout);
  } catch {
    version = null;
  }
  const required = parseVersion(MIN_PI_VERSION) ?? [1, 4, 0];
  return {
    binary,
    version: version ? version.join(".") : null,
    compatible: version ? atLeast(version, required) : false,
  };
}

/** One safe Node boundary for the editor catalog and actual-folder launch preflight. */
async function inspectPiMetadata(folder) {
  const host = parseOrNull(await readTextFile(`${appHome()}/mods/pi-schedulers/host.json`));
  if (typeof host?.command !== "string" || !Array.isArray(host.args)) throw new Error("Reinstall Schedulers to restore its Pi metadata host.");
  const result = await exec(host.command, [...host.args, "models", "--json", "--folder", folder]);
  const metadata = parseOrNull(result.stdout);
  if (!Array.isArray(metadata?.models) || metadata.models.some((model) =>
    typeof model.provider !== "string" || typeof model.id !== "string" || typeof model.name !== "string") ||
    typeof metadata.launch?.ready !== "boolean" || typeof metadata.launch.firstMateWorker !== "boolean") {
    throw new Error("Could not inspect Pi startup configuration. Check Pi and retry.");
  }
  return metadata;
}

// ------------------------------------------------------------- the dispatcher

/** Where a run starts: the task folder, an existing checkout, or a fresh worktree. */
async function prepareFolder(task, runId) {
  if (task.workspace.mode === "existing") return task.workspace.path;
  if (task.workspace.mode !== "worktree") return task.folder;
  const base = task.workspace.baseBranch || "HEAD";
  const branch = worktreeBranch(task.name, runId);
  const destination = `${home()}/${worktreePath(repoName(task.folder), branch)}`;
  const result = await exec("git", ["-C", task.folder, "worktree", "add", "-b", branch, destination, base]);
  if (result.code !== 0) throw new Error(String(result.stderr ?? "").trim().split("\n")[0] || `git worktree add exited ${result.code}`);
  return destination;
}

function schedulersSpace() {
  return spaces().find((space) => space.named && space.name === SCHEDULERS_SPACE) ?? null;
}

let runtime = null;

class SchedulerRuntime {
  constructor() {
    this.records = [];
    this.problems = [];
    this.error = "";
    this.busy = false;
    this.armed = false;
    this.stalled = false;
    this.cx = null;
    this.dispatching = new Set();
    this.spaceRequested = false;
    this.pi = null;
    this.piLookup = null;
  }

  start(cx) {
    this.cx = cx;
    if (this.armed && !this.stalled) return;
    this.armed = true;
    this.stalled = false;
    cx.timer.every(TICK_MS, (inner) => {
      this.cx = inner;
      void this.tick();
    });
    void this.tick();
  }

  notifyView() {
    try {
      this.cx?.notify();
    } catch {
      this.stalled = true;
    }
  }

  async load() {
    const snapshot = await readStore();
    this.records = snapshot.records;
    this.problems = snapshot.problems;
    this.error = "";
    return snapshot;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.load();
      // Complete a partially saved schedule edit from current bytes, never from
      // a cached desired state. Persist reconciliation once so it cannot slide
      // an interval forward again on every read.
      for (const candidate of this.records) {
        if (candidate.stateRaw === serializeState(candidate.state)) continue;
        await withTaskLock(candidate.task.id, async () => {
          const current = await readRecord(candidate.task.id);
          if (!current) return;
          if (current.stateRaw !== serializeState(current.state)) await writeStateFile(current, current.state);
          Object.assign(candidate, current);
        }, true);
      }
      const plan = planDue(this.records, Date.now());
      for (const candidate of plan.missed) {
        await withTaskLock(candidate.task.id, async () => {
          const current = await readRecord(candidate.task.id);
          if (!current || dueInstant(current.state, 0) !== dueInstant(candidate.state, 0)) return;
          if (!planDue([current], Date.now()).missed.length) return;
          await writeStateFile(current, reaimMissed(current.state, current.task, Date.now()));
        }, true);
      }
      for (const record of plan.dispatch) await this.dispatch(record);
      await this.load();
      this.syncTabs();
      announceChange();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.notifyView();
    }
  }

  /** Acknowledge creation; even rejection must clear the pending flag. */
  async ensureSpace(folder) {
    const space = schedulersSpace();
    if (space) return space;
    if (this.spaceRequested) return null;
    this.spaceRequested = true;
    try {
      const result = await exec("herdr-app", ["do", "space.new", JSON.stringify({ name: SCHEDULERS_SPACE, tab: SCHEDULERS_SPACE, folder })]);
      if (result.code !== 0) throw new Error(String(result.stderr || result.stdout || "").trim() || `Space creation exited ${result.code}`);
      const reply = parseOrNull(result.stdout);
      if (typeof reply?.space !== "string" || !reply.space) throw new Error("Space creation returned no accepted space id.");
      // v0.1.12 new_space replies with {space, tab, terminal} after spawn and
      // add_space succeed. Use that id even before this copy's model refreshes.
      return { id: reply.space };
    } finally {
      this.spaceRequested = false;
    }
  }

  async dispatch(candidate) {
    const taskId = candidate.task.id;
    if (this.dispatching.has(taskId)) return;
    this.dispatching.add(taskId);
    try {
      await withTaskLock(taskId, async () => {
        // Claim, current-state decision, begin and launch are one transaction.
        // Cached candidate bytes never authorize a launch or a state overwrite.
        const record = await readRecord(taskId);
        if (!record || dueInstant(record.state, 0) !== dueInstant(candidate.state, 0)) return;
        if (!planDue([record], Date.now()).dispatch.length) return;
        let runId = null;
        let accepted = false;
        try {
          const space = await this.ensureSpace(record.task.folder || home());
          if (!space) return;
          const pi = await (this.piLookup ??= resolvePi());
          this.pi = pi;
          if (!pi.compatible) {
            throw new Error(
              `Scheduled runs require Pi ${MIN_PI_VERSION} or newer for the supported configured-runtime policy. The pi on PATH${pi.version ? ` is ${pi.version}` : " could not be version-checked"}. Update Pi, then retry.`,
            );
          }
          runId = newRunId(Date.now(), entropy(6));
          await writeStateFile(record, beginRun(record.state, runId, Date.now()));
          const folder = await prepareFolder(record.task, runId);
          const metadata = await inspectPiMetadata(folder);
          if (!metadata.launch.ready) throw new Error(metadata.launch.error || "Pi startup configuration needs attention before this run.");
          const argv = buildPiArgv(record.task, runId, pi.binary, { firstMateWorker: metadata.launch.firstMateWorker });
          const tabName = runTabName(record.task.name, Date.now());
          const tabId = newTabId(entropy(16));
          const result = await hc(buildAdoptionArgs({
            spaceId: space.id, tabId, folder,
            terminalName: runTerminalName(record.task.name, runId), argv,
          }));
          if (result.code !== 0) throw new Error(String(result.stderr ?? "").trim().split("\n")[0] || `hc run exited ${result.code}`);
          accepted = true;
          await writeStateFile(record, finishRun(record.state, record.task, {
            runId, acceptedAt: Date.now(), sessionId: runId, folder, tabId, tabName,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Never turn an accepted launch into a retryable pre-launch failure.
          if (accepted) throw new Error(`Launch ${runId} was accepted, but its result could not be saved: ${message}. Inspect before any recovery.`);
          try {
            await writeStateFile(record, failRun(record.state, record.task, runId, message, Date.now()));
          } catch (saveError) {
            throw new Error(`Could not record a failed run for ${record.task.name}: ${String(saveError?.message ?? saveError)}`);
          }
          notify({ title: "Scheduled run failed", body: `${record.task.name}: ${message}`, level: "error", timeout: 8000 });
        }
      }, true);
    } finally {
      this.dispatching.delete(taskId);
    }
  }

  /** Name adopted tabs once they appear. Identity was already saved at acceptance. */
  syncTabs() {
    const space = schedulersSpace();
    if (!space) return;
    for (const record of this.records) {
      const { lastTabId, lastTabName } = record.state;
      if (!lastTabName) continue;
      const tab =
        (lastTabId && space.tabs.find((entry) => entry.id === lastTabId)) || space.tabs.find((entry) => entry.name === lastTabName);
      if (!tab) continue;
      if (!tab.named) run("tab.rename", { id: tab.id, name: lastTabName });
    }
  }

}

/** The bar copy is the only caller. */
function ensureRuntime(cx) {
  if (!runtime) runtime = new SchedulerRuntime();
  runtime.start(cx);
  return runtime;
}

// ------------------------------------------------------------------- helpers

function entropy(bytes) {
  const source = globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`;
  return source
    .replace(/[^a-f0-9]/gi, "")
    .padEnd(bytes * 2, "0")
    .slice(0, bytes * 2);
}

function findLayoutNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findLayoutNode(child, id);
    if (found) return found;
  }
  return null;
}

function schedulerPanelSelected() {
  const root = layout();
  return !findLayoutNode(root, "panel")?.hidden && findLayoutNode(root, "panel-body")?.active === "schedulers";
}

function toggleSchedulerPanel() {
  const root = layout();
  if (!findLayoutNode(root, "panel-body")?.children?.some((node) => node.id === "schedulers")) {
    notify({ title: "Scheduler panel is not installed", body: "Reinstall into a personal layout with the native Files/Changes panel.", level: "error" });
    return;
  }
  if (schedulerPanelSelected()) run("layout.hide", { id: "panel" });
  else {
    run("layout.select", { stack: "panel-body", child: "schedulers" });
    run("layout.show", { id: "panel" });
  }
}

/** Open the run's own tab, or resume its session when the tab is gone. */
async function openRunResult(record) {
  const space = schedulersSpace();
  const state = record.state;
  if (space) {
    const tab =
      (state.lastTabId && space.tabs.find((entry) => entry.id === state.lastTabId)) ||
      (state.lastTabName && space.tabs.find((entry) => entry.name === state.lastTabName));
    if (tab) {
      run("space.select", { id: space.id });
      run("tab.select", { id: tab.id });
      return;
    }
  }
  if (!state.lastSessionId || !state.lastFolder) {
    notify({ title: "No run to open yet", body: record.task.name, level: "info" });
    return;
  }
  const pi = await resolvePi();
  run("tab.new", {
    name: `Resume ${record.task.name}`.slice(0, 60),
    ...(space ? { space: space.id } : {}),
    folder: state.lastFolder,
    argv: [pi.binary, "--session", state.lastSessionId],
  });
  if (space) run("space.select", { id: space.id });
}

function openSchedulersSpace() {
  const space = schedulersSpace();
  if (space) {
    run("space.select", { id: space.id });
    return;
  }
  run("space.new", { name: SCHEDULERS_SPACE, folder: home() });
}

function pill(t, id, label, active, action) {
  return Button.new(id)
    .accessibility_label(label)
    .selected(active)
    .flex_none()
    .h(27)
    .px(8)
    .items_center()
    .rounded(5)
    .text_size(11)
    .bg(active ? t.selected : t.chrome)
    .text_color(active ? t.foreground : t.muted)
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .focus((style) => style.border(1).border_color(t.accent))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => action(cx))
    .child(label);
}

function actionButton(t, id, label, action, tone) {
  return Button.new(id)
    .accessibility_label(label)
    .flex_none()
    .h(26)
    .px(8)
    .items_center()
    .rounded(5)
    .text_size(11.5)
    .text_color(tone === "danger" ? t.blocked : tone === "primary" ? t.foreground : t.muted)
    .bg(tone === "primary" ? t.selected : t.chrome)
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .focus((style) => style.border(1).border_color(t.accent))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => action(cx))
    .child(label);
}

function emptyRow(t, text) {
  return div().p(14).text_size(12).text_color(t.dim).child(text);
}

const MODE_LABELS = [
  ["root", "Project folder"],
  ["existing", "Existing worktree"],
  ["worktree", "New worktree"],
];

function signatureOf(records) {
  return records
    .map((record) => `${record.task.id}:${record.task.updatedAt}:${record.state.nextRunAt}:${record.state.lastRunStatus}:${record.state.runCount}:${record.state.runRequestedAt}`)
    .join("|");
}

export default class Schedulers extends View {
  init(_props, cx) {
    this.slot = props()?.slot ?? "bar";
    this.records = [];
    this.problems = [];
    this.loadError = "";
    this.errors = {};
    this.problem = "";
    this.confirmDelete = null;
    this.ready = false;
    this.editing = false;
    this.handle = cx.focus_handle();
    // Retire a restored window from the old overlay build. No overlay copy may
    // own a clock or keep the main scheduler floating after this upgrade.
    const overlay = props()?.overlay;
    if (overlay) {
      closeOverlay(overlay);
      setShared("pi-schedulers.window", null);
      return;
    }
    if (this.slot === "bar") {
      // Native tabs owns per-space restoration; include our choice without
      // replacing the person's enabled Files/Changes entries.
      const panels = shared("workspace.panels") ?? ["files", "changes"];
      if (!panels.includes("schedulers")) setShared("workspace.panels", [...panels, "schedulers"]);
      this.runtime = ensureRuntime(cx);
      return;
    }
    // Panel and its editor are authors/readers only, never a second clock.
    this.workspaceMenu = new Dropdown("workspace", "Workspace", cx);
    this.modelMenu = new Dropdown("pi-model", "Model", cx, true);
    this.thinkingMenu = new Dropdown("thinking", "Thinking", cx);
    this.models = [];
    this.modelsLoading = false;
    this.modelsLoaded = false;
    this.modelsError = "";
    cx.spawn(async (inner) => {
      await this.refresh(inner);
      this.ready = true;
      inner.notify();
    });
    cx.timer.every(2500, (inner) => void this.refresh(inner));
  }

  /** Re-read definitions and run state for this copy. Renders only on a change. */
  async refresh(cx) {
    try {
      const snapshot = await readStore();
      const signature = signatureOf(snapshot.records);
      const problems = snapshot.problems.join("\n");
      if (signature === this.signature && problems === this.problemsSignature && !this.loadError) return;
      this.signature = signature;
      this.problemsSignature = problems;
      this.records = snapshot.records;
      this.problems = snapshot.problems;
      this.loadError = "";
      cx.notify();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === this.loadError) return;
      this.loadError = message;
      cx.notify();
    }
  }

  record(taskId) {
    return this.records.find((entry) => entry.task.id === taskId) ?? null;
  }

  // ---------------------------------------------------------------- the bar

  renderBar(cx) {
    const t = theme();
    const state = this.runtime;
    const enabled = state?.records?.filter((record) => record.task.enabled).length ?? 0;
    const selected = schedulerPanelSelected();
    return h_flex()
      .id("schedulers-bar")
      .size_full()
      .min_w(0)
      .px(6)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .on_mouse_down("left", (_event, inner) => inner.stop_propagation())
      .child(
        h_flex()
          .id("schedulers-open")
          .h(26)
          .px(9)
          .gap(6)
          .items_center()
          .rounded(6)
          .min_w(0)
          .bg(selected ? t.selected : t.chrome)
          .text_color(selected ? t.foreground : t.muted)
          .text_size(12)
          .hover((style) => style.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_event, inner) => inner.stop_propagation())
          .on_click(() => toggleSchedulerPanel())
          .child(svg("mods/pi-schedulers/clock.svg").size(14))
          .child(div().min_w(0).truncate().child("Schedulers"))
          .when(enabled > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(enabled)))),
      )
      .when(Boolean(state?.error), (el) =>
        el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.blocked).child(state.error)),
      );
  }

  // ---------------------------------------------------------- the dashboard

  row(record, cx) {
    const t = theme();
    const task = record.task;
    const state = record.state;
    const when = state.runRequestedAt
      ? "run requested"
      : state.nextRunAt
        ? `next ${formatInstant(state.nextRunAt)}`
        : "no next run";
    const last = state.lastRunStatus ? ` · ${state.lastRunStatus}` : "";
    const tone = state.lastRunStatus === "failed" ? t.blocked : state.lastRunStatus === "running" ? t.working : t.dim;
    return v_flex()
      .id(`task-${task.id}`)
      .min_w(0)
      .gap(5)
      .p(10)
      .rounded(8)
      .bg(t.surface)
      .border(1)
      .border_color(t.border)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().size(6).rounded(3).bg(task.enabled ? t.accent : t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(task.enabled ? t.foreground : t.muted).child(task.name))
          .child(div().min_w(0).text_size(11).text_color(t.dim).child(scheduleLabel(task.schedule))),
      )
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(tone).child(`${when}${last}`))
          .when(Boolean(state.lastRunError), (el) =>
            el.child(div().max_w(180).truncate().text_size(11).text_color(t.blocked).child(state.lastRunError)),
          ),
      )
      .child(div().text_size(11).text_color(t.dim).truncate().child(`${task.folder} · ${task.workspace.mode}`))
      .child(
        h_flex()
          .flex_wrap()
          .gap(4)
          .items_center()
          .child(
            actionButton(
              t,
              `run-${task.id}`,
              "Run now",
              async (inner) => {
                try {
                  const fresh = this.record(task.id);
                  if (!fresh) throw new Error("That task was deleted.");
                  if (!fresh.task.enabled) throw new Error("Enable the task before running it.");
                  await changeDefinition(task.id, fresh.taskRaw, "run");
                  announceChange();
                  inner.notify();
                } catch (error) {
                  notify({ title: "Could not request the run", body: String(error?.message ?? error), level: "error" });
                }
              },
              "primary",
            ),
          )
          .child(actionButton(t, `edit-${task.id}`, "Edit", (inner) => this.openEditor(task.id, inner)))
          .child(
            actionButton(t, `toggle-${task.id}`, task.enabled ? "Pause" : "Resume", async (inner) => {
              try {
                const fresh = this.record(task.id);
                if (!fresh) throw new Error("That task was deleted.");
                const enabled = !fresh.task.enabled;
                await changeDefinition(task.id, fresh.taskRaw, enabled ? "enable" : "pause");
                announceChange();
                await this.refresh(inner);
              } catch (error) {
                notify({ title: "Could not save", body: String(error?.message ?? error), level: "error" });
              }
            }),
          )
          .child(
            actionButton(
              t,
              `delete-${task.id}`,
              this.confirmDelete === task.id ? "Delete for good" : "Delete",
              async (inner) => {
                if (this.confirmDelete !== task.id) {
                  this.confirmDelete = task.id;
                  inner.notify();
                  inner.timer.after(4000, (again) => {
                    if (this.confirmDelete === task.id) {
                      this.confirmDelete = null;
                      again.notify();
                    }
                  });
                  return;
                }
                this.confirmDelete = null;
                try {
                  await changeDefinition(task.id, record.taskRaw, "remove");
                  announceChange();
                  await this.refresh(inner);
                } catch (error) {
                  notify({ title: "Could not delete", body: String(error?.message ?? error), level: "error" });
                }
              },
              "danger",
            ),
          )
          .child(div().flex_1())
          .when(Boolean(state.lastRunId), (el) =>
            el.child(
              actionButton(t, `open-${task.id}`, state.lastTabId ? "Open run" : "Open result", () => void openRunResult(record)),
            ),
          ),
      );
  }

  renderDashboard(cx) {
    const t = theme();
    const records = this.records ?? [];
    const problems = this.problems ?? [];
    return v_flex()
      .id("schedulers-dashboard")
      .size_full()
      .min_w(0)
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .text_color(t.foreground)
      .track_focus(this.handle)
      .child(this.panelHeader(cx))
      .when(Boolean(this.loadError), (el) => el.child(div().p(10).text_size(11.5).text_color(t.blocked).child(this.loadError)))
      .when(problems.length > 0, (el) =>
        el.child(div().p(10).text_size(11).text_color(t.blocked).child(`Unreadable files: ${problems.join("; ")}`)),
      )
      .when(!this.loadError && records.length === 0, (el) =>
        el.child(emptyRow(t, "No scheduled tasks yet. New task opens the editor.")),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .min_h(0)
          .overflow_y_scrollbar()
          .p(10)
          .gap(8)
          .children(records.map((record) => this.row(record, cx))),
      );
  }

  // ------------------------------------------------------------- the editor

  openEditor(taskId, cx) {
    if (!this.ready || this.loadError) {
      notify({ title: "Cannot open the editor", body: this.loadError || "The scheduler store is still loading.", level: "error" });
      return;
    }
    this.initEditor(taskId);
    this.loadModels(cx);
    this.errors = {};
    this.problem = "";
    this.editing = true;
    this.handle.focus();
    cx.notify();
  }

  cancelEditor(cx) {
    this.editing = false;
    cx.notify();
  }

  initEditor(taskId) {
    const record = taskId ? this.record(taskId) : null;
    this.existing = record?.task ?? null;
    this.existingRaw = record?.taskRaw ?? null;
    this.requireExisting = Boolean(taskId);
    this.workspace = this.existing?.workspace.mode ?? "root";
    this.mode = this.existing?.schedule.type ?? "fixed_time";
    this.enabled = this.existing?.enabled ?? true;
    this.originalSchedule = this.existing?.schedule ?? null;
    // A stored daily schedule has no weekday list; showing Mon-Fri here would
    // quietly drop weekends on a prompt-only save.
    this.weekdays = new Set(this.existing ? effectiveWeekdays(this.existing.schedule) : [1, 2, 3, 4, 5]);

    this.name = InputState.new({ value: this.existing?.name ?? "", placeholder: "Nightly dependency review" });
    this.prompt = TextareaState.new({ value: this.existing?.prompt ?? "", rows: 4, placeholder: "What should the run do?" });
    this.folder = InputState.new({
      value: this.existing?.folder ?? spaces().find((space) => space.active)?.folder ?? home(),
      placeholder: "/absolute/folder",
    });
    this.existingPath = InputState.new({
      value: this.existing?.workspace.mode === "existing" ? this.existing.workspace.path : "",
      placeholder: "/absolute/worktree",
    });
    this.baseBranch = InputState.new({
      value: this.existing?.workspace.mode === "worktree" ? this.existing.workspace.baseBranch : "main",
      placeholder: "main",
    });
    this.intervalText = this.existing?.schedule.type === "interval" ? String(this.existing.schedule.everyMs / 60_000) : "15";
    this.interval = InputState.new({ value: this.intervalText, placeholder: "15" });
    this.timeText = this.existing?.schedule.type === "fixed_time" ? this.existing.schedule.timeOfDay : "09:00";
    this.time = InputState.new({ value: this.timeText, placeholder: "09:00" });
    this.model = this.existing?.model ?? "";
    this.thinking = this.existing?.thinking ?? "";
    this.folderProblem = "";
    for (const menu of [this.workspaceMenu, this.modelMenu, this.thinkingMenu]) { menu.open = false; menu.highlight = 0; }
    this.modelMenu.search.set_value("");
  }

  /** Keep an untouched schedule exactly as stored, including its representation. */
  editorSchedule() {
    return scheduleFromDraft({
      mode: this.mode,
      intervalMinutes: this.interval.value(),
      timeOfDay: this.time.value(),
      weekdays: [...this.weekdays],
      original: this.originalSchedule,
      originalIntervalMinutes: this.existing?.schedule.type === "interval" ? this.intervalText : null,
      originalTimeOfDay: this.existing?.schedule.type === "fixed_time" ? this.timeText : null,
    });
  }

  async saveEditor(cx) {
    const built = buildTask(
      {
        id: this.existing?.id,
        createdAt: this.existing?.createdAt,
        name: this.name.value(),
        prompt: this.prompt.value(),
        enabled: this.enabled,
        folder: this.folder.value(),
        workspace: { mode: this.workspace, path: this.existingPath.value(), baseBranch: this.baseBranch.value() },
        schedule: this.editorSchedule(),
        model: this.model,
        thinking: this.thinking,
        tools: this.existing?.tools ?? [...DEFAULT_TOOLS],
      },
      Date.now(),
      this.existing ?? undefined,
    );
    if (built.errors) {
      this.errors = built.errors;
      this.problem = "";
      cx.notify();
      return;
    }
    this.errors = {};
    const task = built.task;
    if (this.requireExisting && !this.record(task.id)) {
      this.problem = "That task was deleted; cancel this edit.";
      cx.notify();
      return;
    }
    try {
      await saveDefinition(task, this.existingRaw);
      announceChange();
      this.editing = false;
      await this.refresh(cx);
      cx.notify();
    } catch (error) {
      this.problem = `${error instanceof Error ? error.message : String(error)}`;
      cx.notify();
    }
  }

  field(labelText, control, error, t) {
    return v_flex()
      .gap(5)
      .child(div().text_size(11).line_height("13px").text_color(t.muted).child(labelText))
      .child(control)
      .when(Boolean(error), (el) => el.child(div().text_size(11).text_color(t.blocked).child(error)));
  }

  input(state, error, t) {
    return Input.new(state)
      .h(32)
      .px(9)
      .rounded(6)
      .border(1)
      .border_color(error ? t.blocked : t.input)
      .focus((style) => style.border_color(t.accent))
      .bg(t.background)
      .text_size(12)
      .text_color(t.foreground);
  }

  panelHeader(cx) {
    const t = theme();
    const icon = (id, label, file, action) => Button.new(id).size(26).flex_none().rounded(5)
      .items_center().justify_center().text_color(t.muted).tooltip(label).accessibility_label(label)
      .hover((style) => style.bg(t.hover).text_color(t.foreground))
      .focus((style) => style.border(1).border_color(t.accent))
      .on_click((_event, inner) => action(inner))
      .child(svg(`mods/pi-schedulers/${file}.svg`).size(15));
    return h_flex().h(44).flex_none().px(12).gap(7).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/pi-schedulers/clock.svg").size(15))
      .child(div().flex_1().min_w(0).text_size(14).font_semibold().child("Schedulers"))
      .child(icon("new-task", "New task", "plus", (inner) => {
        // Do not discard an unfinished editor when the persistent header is clicked.
        if (!this.editing) this.openEditor(undefined, inner);
      }))
      .child(icon("open-space", "Open space", "open-space", () => openSchedulersSpace()));
  }

  loadModels(cx) {
    if (this.modelsLoading) return;
    this.modelsLoading = true;
    this.modelsError = "";
    cx.notify();
    cx.spawn(async (inner) => {
      try {
        const metadata = await inspectPiMetadata(this.folder.value());
        this.launchPolicy = metadata.launch;
        if (metadata.models.length || !metadata.error) this.models = metadata.models;
        this.defaultModel = typeof metadata.defaultModel === "string" ? metadata.defaultModel : "";
        this.scopedModels = Array.isArray(metadata.scopedModels) ? metadata.scopedModels.filter((value) => typeof value === "string") : [];
        if (this.modelScope === undefined) this.modelScope = this.scopedModels.length > 0;
        this.modelsError = metadata.error ? "Could not refresh all Pi models. Check Pi provider configuration, then Retry." : "";
        this.modelsLoaded = true;
      } catch {
        this.modelsError = "Could not load Pi models. Check Pi provider configuration, then Retry.";
      } finally {
        this.modelsLoading = false;
        inner.notify();
      }
    });
  }

  modelControl(t) {
    const current = this.models.find((model) => `${model.provider}/${model.id}` === this.model);
    this.modelMenu.valueLabel = current?.id ?? (this.model ? `${this.model}${this.modelsLoading && !this.modelsLoaded ? " (checking…)" : " (unavailable)"}` : "Pi default");
    const scoped = this.modelScope && this.scopedModels?.length ? this.models.filter((model) => this.scopedModels.includes(`${model.provider}/${model.id}`)) : this.models;
    const options = [...scoped].sort((a, b) => {
      const rank = (item) => `${item.provider}/${item.id}` === this.model ? 0
        : `${item.provider}/${item.id}` === this.defaultModel ? 1 : 2;
      return rank(a) - rank(b) || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
    }).map((model) => ({ value: `${model.provider}/${model.id}`, label: model.id, detail: `${model.provider} · ${model.name}` }));
    options.unshift({ value: "", label: "Pi default", detail: "Use Pi's startup selection" });
    const extras = [];
    if (this.scopedModels?.length) extras.push(h_flex().gap(4).children([
      pill(t, "models-scoped", "Scoped", this.modelScope, (inner) => { this.modelScope = true; this.modelMenu.highlight = 0; inner.notify(); }),
      pill(t, "models-all", "All models", !this.modelScope, (inner) => { this.modelScope = false; this.modelMenu.highlight = 0; inner.notify(); }),
    ]));
    if (this.modelsLoading) extras.push(div().p(6).text_size(11).text_color(t.muted).role("status").child("Loading Pi models…"));
    if (this.modelsError) extras.push(v_flex().p(6).gap(5).role("alert")
      .child(div().text_size(11).text_color(t.blocked).child(`${this.models.length ? "Showing cached results. " : ""}${this.modelsError}`))
      .child(actionButton(t, "retry-models", "Retry", (inner) => this.loadModels(inner))));
    if (this.modelsLoaded && !this.modelsLoading && !this.modelsError && this.models.length === 0) extras.push(
      v_flex().p(6).gap(5).role("status")
        .child(div().text_size(11).text_color(t.muted).child("No configured Pi models. Add a provider in Pi with /login, then Retry."))
        .child(actionButton(t, "retry-empty-models", "Retry", (inner) => this.loadModels(inner))));
    return this.modelMenu.render(t, this.model, options, (value) => { this.model = value; }, extras);
  }

  step(t, number, title, content) {
    return h_flex().min_w(0).gap(10).items_start()
      .child(v_flex().w(21).flex_none().items_center().self_stretch()
        .child(div().relative().top(-2).size(21).flex_none().rounded(11).border(1).border_color(t.input)
          .bg(t.background).text_size(10).text_color(t.accent).flex().items_center().justify_center().child(String(number)))
        )
      .child(v_flex().flex_1().min_w(0).gap(10)
        .child(div().h(15).line_height("13px").items_center().text_size(11).font_semibold().text_color(t.foreground).child(title))
        .children(content));
  }

  renderEditor(cx) {
    const t = theme();
    if (!this.ready) return v_flex().size_full().min_h(0).rounded(10).overflow_hidden().border_1().border_color(t.border).bg(t.background).child(emptyRow(t, "Reading the scheduler store…"));
    const errors = this.errors ?? {};
    for (const menu of [this.workspaceMenu, this.modelMenu, this.thinkingMenu]) menu.menuWidth = Math.max(0, (this.panelWidth ?? 368) - 62);
    const input = (state, label, error) => this.input(state, error, t).w_full().min_w(0).accessibility_label(label);
    const workspace = v_flex().min_w(0).gap(7)
      .child(this.workspaceMenu.render(t, this.workspace, MODE_LABELS.map(([value, label]) => ({ value, label })),
        (value) => { this.workspace = value; }))
      .when(this.workspace === "existing", (el) => el.child(this.field("Worktree path",
        input(this.existingPath, "Worktree path", errors.workspace), null, t)))
      .when(this.workspace === "worktree", (el) => el.child(this.field("Base branch",
        input(this.baseBranch, "Base branch", errors.workspace), null, t)))
      .when(Boolean(errors.workspace), (el) => el.child(div().text_size(11).text_color(t.blocked).child(errors.workspace)));
    const rhythm = v_flex().gap(7)
      .child(h_flex().gap(4).children([
        pill(t, "mode-fixed", "At a time", this.mode === "fixed_time", (inner) => { this.mode = "fixed_time"; inner.notify(); }),
        pill(t, "mode-interval", "Every interval", this.mode === "interval", (inner) => { this.mode = "interval"; inner.notify(); }),
      ]))
      .when(this.mode === "fixed_time", (el) => el.child(v_flex().gap(6)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(11).text_color(t.muted).child("Time"))
          .child(div().w(98).child(input(this.time, "Time", errors.schedule))))
        .child(h_flex().flex_wrap().gap(3).children(weekdayNames().map((label, index) =>
          pill(t, `day-${index}`, label.slice(0, 2), this.weekdays.has(index), (inner) => {
            if (this.weekdays.has(index)) this.weekdays.delete(index); else this.weekdays.add(index);
            inner.notify();
          }))))
        .when(this.weekdays.size === 0 || this.weekdays.size === 7, (row) => row.child(div().text_size(11).text_color(t.dim).child("every day")))))
      .when(this.mode === "interval", (el) => el.child(h_flex().gap(8).items_center()
        .child(div().text_size(11).text_color(t.muted).child("Minutes"))
        .child(div().w(98).child(input(this.interval, "Minutes", errors.schedule)))))
      .when(Boolean(errors.schedule), (el) => el.child(div().text_size(11).text_color(t.blocked).child(errors.schedule)));
    const body = v_flex().relative().min_w(0).px(14).py(16).gap(17)
      .child(div().absolute().left(24).top(16).bottom(16).w(1).bg(t.input))
      .when(Boolean(this.problem), (el) => el.child(div().role("alert").text_size(11.5).text_color(t.blocked).child(this.problem)))
      .child(this.step(t, 1, "Describe the task", [
        this.field("Name", input(this.name, "Name", errors.name), errors.name, t),
        this.field("Prompt", Textarea.new(this.prompt).h(94).w_full().min_w(0).px(9).py(7).rounded(6)
          .border(1).border_color(errors.prompt ? t.blocked : t.input).bg(t.background).text_size(12)
          .text_color(t.foreground).accessibility_label("Prompt").focus((style) => style.border_color(t.accent)), errors.prompt, t),
      ]))
      .child(this.step(t, 2, "Choose its environment", [
        this.field("Folder", h_flex().min_w(0).gap(6).items_center()
          .child(div().flex_1().min_w(0).child(input(this.folder, "Folder", errors.folder)))
          .child(actionButton(t, "pick-folder", "Choose…", (inner) => {
            inner.spawn(async (again) => {
              try {
                const folder = await pickFolder({ prompt: "Use this folder" });
                if (folder) { this.folder.set_value(folder); this.folderProblem = ""; }
              } catch { this.folderProblem = "Could not open the folder picker. Your folder is unchanged."; }
              again.notify();
            });
          })), errors.folder || this.folderProblem, t),
        this.field("Workspace", workspace, null, t),
      ]))
      .child(this.step(t, 3, "Set the rhythm", [this.field("When", rhythm, null, t)]))
      .child(this.step(t, 4, "Choose how it runs", [
        h_flex().min_w(0).gap(8)
          .child(div().flex_1().min_w(0).child(this.field("Model", this.modelControl(t), errors.model, t)))
          .child(div().w(110).flex_none().min_w(0).child(this.field("Thinking",
            this.thinkingMenu.render(t, this.thinking, [{ value: "", label: "Default" }, ...THINKING_LEVELS.map((value) => ({ value, label: value }))],
              (value) => { this.thinking = value; }), errors.thinking, t))),
        v_flex().gap(0).text_size(10).line_height("16px").text_color(t.dim)
          .child(div().child("Normal Pi tools, extensions and MCP"))
          .child(div().child("Independent session · First Mate off"))
          .when(Boolean(this.launchPolicy?.error), (el) => el.child(div().role("status").text_color(t.blocked).child(this.launchPolicy.error))),
      ]))
      .child(this.step(t, 5, "Enable the task", [
        h_flex().items_center().justify_between().min_w(0)
          .child(div().text_size(12).child("Enabled"))
          .child(Switch.new("enabled").checked(this.enabled).accessibility_label("Enabled")
            .on_change((enabled, inner) => { this.enabled = enabled; inner.notify(); })
            .w(28).h(16).rounded(10).p(2).bg(this.enabled ? t.accent : t.input)
            .focus((style) => style.border(1).border_color(t.foreground))
            .child(h_flex().w_full().justify_end().when(!this.enabled, (el) => el.justify_start())
              .child(div().size(12).rounded(6).bg(t.background)))),
      ]));
    return v_flex().id("schedulers-editor").size_full().min_w(0).min_h(0)
      .rounded(10).overflow_hidden().border_1().border_color(t.border).bg(t.background).text_color(t.foreground).text_size(12).line_height("14px")
      .on_size_change((size, inner) => { if (this.panelWidth !== size.width) { this.panelWidth = size.width; inner.notify(); } })
      .track_focus(this.handle)
      .child(this.panelHeader(cx))
      .child(h_flex().h(42).flex_none().px(12).gap(7).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(this.existing ? "Edit task" : "New task"))
        .child(actionButton(t, "editor-cancel", "Cancel", (inner) => this.cancelEditor(inner)))
        .child(actionButton(t, "editor-save", "Save", (inner) => void this.saveEditor(inner), "primary")))
      .child(v_flex().flex_1().min_w(0).min_h(0).overflow_y_scrollbar().child(body))
      .on_key_down((event, inner) => {
        if (event.key !== "escape") return;
        const menu = [this.workspaceMenu, this.modelMenu, this.thinkingMenu].find((item) => item.open);
        if (menu) menu.close(inner); else this.cancelEditor(inner);
        inner.stop_propagation();
      });
  }

  render(cx) {
    if (props()?.overlay) return div();
    if (this.slot === "bar") return this.renderBar(cx);
    return this.editing ? this.renderEditor(cx) : this.renderDashboard(cx);
  }
}
