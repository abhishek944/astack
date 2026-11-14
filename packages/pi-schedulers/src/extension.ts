/**
 * The Pi side: `/schedulers` authoring and inspection.
 *
 * This extension never starts a timer, because a Pi session is not the host:
 * the Herdr mod owns the clock so that scheduled runs stop with the app. Here
 * a "run" is a request the dispatcher honours on its next tick, and it is
 * refused outright when no Herdr window answers.
 *
 * Every write touches one task's definition file (and, when the schedule moves,
 * that task's run-state file) through the same store the mod and the CLI use.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatInstant, scheduleLabel } from "./core/schedule.js";
import { matchRecords } from "./core/transitions.js";
import { registerSchedulerCreate } from "./create-tool.js";
import { appReachable } from "./host/app.js";
import { installSchedulers } from "./host/install.js";
import { schedulerDirectory, statesDirectory, tasksDirectory } from "./host/paths.js";
import { changeTask, loadSnapshot, type TaskEntry } from "./host/store.js";

const HELP = `Usage: /schedulers [list | show <name|id> | run <name|id> | pause <name|id> | resume <name|id> | rm <name|id> | install [--force] | paths]

The scheduler itself runs inside the Herdr app: click Schedulers beside Files
and Changes to write and edit tasks there. This command reads and changes the
same store, and "run" asks the running app to dispatch now.`;

function line(record: TaskEntry): string {
  const { task, state } = record;
  const when = state.runRequestedAt
    ? "run requested"
    : state.nextRunAt
      ? `next ${formatInstant(state.nextRunAt)}`
      : "not scheduled";
  const last = state.lastRunStatus ? ` · last ${state.lastRunStatus}` : "";
  const error = state.lastRunError ? ` · ${state.lastRunError}` : "";
  return `${task.enabled ? "on " : "off"} ${task.name} — ${scheduleLabel(task.schedule)}, ${when}${last}${error}`;
}

function resolve(records: readonly TaskEntry[], needle: string): TaskEntry {
  const matches = matchRecords(records, needle);
  if (matches.length === 0) throw new Error(`No scheduled task matches "${needle}".`);
  if (matches.length > 1) throw new Error(`"${needle}" matches ${matches.length} tasks; use the full id.`);
  return matches[0] as TaskEntry;
}

async function handle(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const command = parts[0] ?? "list";
  if (command === "help") {
    ctx.ui.notify(HELP, "info");
    return;
  }
  if (command === "install") {
    const report = await installSchedulers({ force: parts.includes("--force") });
    const summary = [
      `Herdr home ${report.appHome}; wrote ${report.written.length} file(s), kept ${report.identical.length} identical.`,
      report.drifted.length ? `Kept customized files: ${report.drifted.join(", ")} (use --force to replace).` : "",
      `Layout ${report.layout.name}: ${report.layout.note}`,
      report.check.ran ? `Mod check ${report.check.ok ? "passed" : `failed: ${report.check.output}`}` : "Mod check skipped (herdr-app not on PATH).",
    ].filter(Boolean);
    ctx.ui.notify(summary.join("\n"), report.check.ran && !report.check.ok ? "error" : "info");
    return;
  }
  if (command === "paths") {
    ctx.ui.notify(`Store: ${schedulerDirectory()}\nTasks: ${tasksDirectory()}\nRun state: ${statesDirectory()}`, "info");
    return;
  }

  const snapshot = await loadSnapshot(tasksDirectory(), statesDirectory());
  if (command === "list") {
    if (snapshot.records.length === 0) {
      ctx.ui.notify(`No scheduled tasks yet. Store: ${schedulerDirectory()}`, "info");
      return;
    }
    const sorted = [...snapshot.records].sort((a, b) => (a.state.nextRunAt ?? Infinity) - (b.state.nextRunAt ?? Infinity));
    const problems = snapshot.problems.length ? `\n\nUnreadable files:\n${snapshot.problems.join("\n")}` : "";
    ctx.ui.notify(`${sorted.map(line).join("\n")}${problems}`, "info");
    return;
  }

  const needle = parts[1];
  if (!needle) throw new Error(`Say which task. ${HELP}`);
  const record = resolve(snapshot.records, needle);

  switch (command) {
    case "show": {
      const state = record.state;
      const details = [
        `${record.task.name} (${record.task.id})`,
        `${record.task.enabled ? "enabled" : "paused"} · ${scheduleLabel(record.task.schedule)}`,
        state.nextRunAt ? `next ${formatInstant(state.nextRunAt)}` : "no next run",
        `runs ${state.runCount}${state.lastRunStatus ? `, last ${state.lastRunStatus}` : ""}`,
        state.lastRunError ? `last error: ${state.lastRunError}` : "",
        `folder ${record.task.folder} · ${record.task.workspace.mode}`,
        `model ${record.task.model ?? "Pi default"}${record.task.thinking ? ` (${record.task.thinking})` : ""}`,
        "normal Pi tools, extensions and MCP · independent session · existing project trust",
        state.lastSessionId ? `last session ${state.lastSessionId}` : "",
      ].filter(Boolean);
      ctx.ui.notify(details.join("\n"), "info");
      return;
    }
    case "run": {
      if (!record.task.enabled) throw new Error("Enable the task before running it.");
      if (!(await appReachable())) {
        throw new Error("Herdr is not running. The scheduler dispatches only while the app runs, so nothing was requested.");
      }
      await changeTask(undefined, record.task.id, record.taskRaw, "run");
      ctx.ui.notify(`Run requested for ${record.task.name}; the scheduler dispatches it within a few seconds.`, "info");
      return;
    }
    case "pause":
    case "resume": {
      const enabled = command === "resume";
      await changeTask(undefined, record.task.id, record.taskRaw, enabled ? "enable" : "pause");
      ctx.ui.notify(`${enabled ? "Resumed" : "Paused"} ${record.task.name}.`, "info");
      return;
    }
    case "rm": {
      await changeTask(undefined, record.task.id, record.taskRaw, "remove");
      ctx.ui.notify(`Removed ${record.task.name}.`, "info");
      return;
    }
    default:
      ctx.ui.notify(HELP, "warning");
  }
}

export function registerSchedulers(pi: ExtensionAPI): void {
  registerSchedulerCreate(pi);
  pi.registerCommand("schedulers", {
    description: "Scheduled Pi runs hosted by the running Herdr app",
    handler: async (args, ctx) => {
      try {
        await handle(args, ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
