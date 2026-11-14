/**
 * `pi-schedulers` — authoring and inspection for the Herdr-hosted scheduler.
 *
 * This command never runs a timer and never dispatches a scheduled run: the
 * clock lives in the Herdr mod, because the scheduler must stop when the app
 * does. `run` records a run-now request that the dispatcher picks up while the
 * window is open, and refuses when it is not.
 *
 * Writes touch exactly one task's definition file and, when the schedule moves,
 * that task's run-state file. A conflicted write is refused and reported.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildTask, type Task, type TaskInput } from "../core/model.js";
import { formatInstant, type Schedule, scheduleLabel } from "../core/schedule.js";
import { findRecord, matchRecords, planDue } from "../core/transitions.js";
import { appReachable } from "./app.js";
import { installSchedulers } from "./install.js";
import { lockPath, locksDirectory, schedulerDirectory, statePath, statesDirectory, taskPath, tasksDirectory } from "./paths.js";
import { changeTask, loadSnapshot, saveTask, type TaskEntry } from "./store.js";

const USAGE = `pi-schedulers — scheduled Pi runs, hosted by the open Herdr window

Usage
  pi-schedulers models --json [--folder <path>]
  pi-schedulers list [--json]
  pi-schedulers show <id|name> [--json]
  pi-schedulers add --name <name> --prompt <text> --folder <path> (--interval <15m> | --at <09:30> [--days mon,tue])
      [--workspace root|existing|worktree] [--existing <path>] [--base <branch>]
      [--model provider/model[:thinking]] [--thinking <level>] [--disabled]
  pi-schedulers edit <id|name> [same flags as add]
  pi-schedulers enable <id|name> | pause <id|name> | rm <id|name>
  pi-schedulers run <id|name>
  pi-schedulers install [--layout <name>] [--force]
  pi-schedulers state [--json]

Scheduled runs start a fresh persistent Pi session in one tab of the Schedulers
space. The scheduler only ticks while the Herdr app runs, so "run" records a
request instead of dispatching; it refuses when the window is not reachable.
Runs keep normal Pi tools/extensions/MCP and existing project trust. Legacy
--tools metadata is retained for compatibility but does not restrict execution.
`;

interface Parsed {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const [name, inline] = splitFlag(arg.slice(2));
      if (!name) continue;
      if (inline !== undefined) flags.set(name, inline);
      else {
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(name, next);
          index += 1;
        } else flags.set(name, true);
      }
      continue;
    }
    if (!command) command = arg;
    else positionals.push(arg);
  }
  return { command, positionals, flags };
}

function splitFlag(raw: string): [string, string | undefined] {
  const equals = raw.indexOf("=");
  return equals < 0 ? [raw, undefined] : [raw.slice(0, equals), raw.slice(equals + 1)];
}

function flagText(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function flagPresent(parsed: Parsed, name: string): boolean {
  return parsed.flags.has(name);
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i;

/** `15m`, `90s`, `2h`, or a bare number of minutes. */
export function parseInterval(value: string): number {
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`Cannot read the interval "${value}". Use 15m, 90s, 2h or a number of minutes.`);
  const amount = Number(match[1]);
  const unit = (match[2] ?? "m").toLowerCase();
  const factor = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  const ms = Math.round(amount * factor);
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("The interval must be longer than zero.");
  return ms;
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** `mon,tue`, `1,3,5`, `weekdays`, `weekends` or `daily`. */
export function parseDays(value: string): number[] | undefined {
  const wanted = value.trim().toLowerCase();
  if (!wanted || wanted === "daily" || wanted === "every" || wanted === "all") return undefined;
  if (wanted === "weekdays") return [1, 2, 3, 4, 5];
  if (wanted === "weekends") return [0, 6];
  const days = new Set<number>();
  for (const part of wanted.split(/[,\s]+/).filter(Boolean)) {
    const numeric = Number(part);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) {
      days.add(numeric);
      continue;
    }
    const index = DAY_NAMES.indexOf(part.slice(0, 3));
    if (index < 0) throw new Error(`Cannot read the weekday "${part}". Use mon,tue or 0-6.`);
    days.add(index);
  }
  return days.size ? [...days].sort((a, b) => a - b) : undefined;
}

function parseTools(value: string): string[] {
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function scheduleFromFlags(parsed: Parsed, existing?: Schedule): Schedule {
  const interval = flagText(parsed, "interval");
  const at = flagText(parsed, "at");
  if (interval && at) throw new Error("Choose either --interval or --at, not both.");
  if (interval) return { type: "interval", everyMs: parseInterval(interval) };
  if (at) {
    const days = flagPresent(parsed, "days")
      ? parseDays(flagText(parsed, "days") ?? "")
      : existing?.type === "fixed_time"
        ? existing.weekdays
        : undefined;
    return days ? { type: "fixed_time", timeOfDay: at, weekdays: days } : { type: "fixed_time", timeOfDay: at };
  }
  if (existing) return existing;
  throw new Error("Say when it runs: --interval 15m, or --at 09:30 --days mon,tue.");
}

function inputFromFlags(parsed: Parsed, existing?: Task): TaskInput {
  const workspaceMode = flagText(parsed, "workspace") ?? existing?.workspace.mode ?? "root";
  const workspaceProps = {
    mode: workspaceMode,
    path: flagText(parsed, "existing") ?? (existing?.workspace.mode === "existing" ? existing.workspace.path : undefined),
    baseBranch: flagText(parsed, "base") ?? (existing?.workspace.mode === "worktree" ? existing.workspace.baseBranch : undefined),
  };
  const enabled = flagPresent(parsed, "enabled") ? true : flagPresent(parsed, "disabled") ? false : (existing?.enabled ?? true);
  const input: TaskInput = {
    id: existing?.id,
    name: flagText(parsed, "name") ?? existing?.name,
    prompt: flagText(parsed, "prompt") ?? existing?.prompt,
    folder: flagText(parsed, "folder") ?? existing?.folder,
    workspace: workspaceProps,
    schedule: scheduleFromFlags(parsed, existing?.schedule),
    enabled,
    createdAt: existing?.createdAt,
  };
  const model = flagText(parsed, "model");
  if (model !== undefined) input.model = model;
  else if (existing) input.model = existing.model;
  const thinking = flagText(parsed, "thinking");
  if (thinking !== undefined) input.thinking = thinking;
  else if (existing) input.thinking = existing.thinking;
  const tools = flagText(parsed, "tools");
  if (tools !== undefined) input.tools = parseTools(tools);
  else if (existing) input.tools = existing.tools;
  return input;
}

function resolveOne(records: readonly TaskEntry[], needle: string): TaskEntry {
  const matches = matchRecords(records, needle);
  if (matches.length === 0) throw new Error(`No scheduled task matches "${needle}".`);
  if (matches.length > 1) throw new Error(`"${needle}" matches ${matches.length} tasks; use the full id.`);
  return matches[0] as TaskEntry;
}

function describeTask(record: TaskEntry): string {
  const { task, state } = record;
  const parts = [task.enabled ? "enabled" : "paused", scheduleLabel(task.schedule)];
  if (state.runRequestedAt) parts.push("run requested");
  else if (state.nextRunAt) parts.push(`next ${formatInstant(state.nextRunAt)}`);
  if (state.lastRunStatus) parts.push(`last ${state.lastRunStatus}`);
  if (state.lastRunError) parts.push(`error: ${state.lastRunError}`);
  parts.push(`${state.runCount} run${state.runCount === 1 ? "" : "s"}`);
  return `${task.name} (${task.id})\n    ${parts.join(" · ")}\n    ${task.folder}`;
}

async function packageVersion(): Promise<string> {
  try {
    const text = await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8");
    return (JSON.parse(text) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "" || parsed.command === "help" || flagPresent(parsed, "help")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const override = flagText(parsed, "app-home");
  const env = override ? ({ ...process.env, HERDR_APP_HOME: override } as NodeJS.ProcessEnv) : process.env;
  const tasksDir = tasksDirectory(env);
  const statesDir = statesDirectory(env);
  const json = flagPresent(parsed, "json");

  try {
    switch (parsed.command) {
      case "models": {
        const { discoverModels } = await import("./models.js");
        const result = await discoverModels(flagText(parsed, "folder") ?? process.cwd());
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result.error && result.models.length === 0 ? 1 : 0;
      }
      case "version": {
        process.stdout.write(`${await packageVersion()}\n`);
        return 0;
      }
      case "install": {
        const layout = flagText(parsed, "layout");
        const report = await installSchedulers({ env, ...(layout ? { layout } : {}), force: flagPresent(parsed, "force") });
        if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        else {
          const lines = [
            `Herdr home: ${report.appHome}`,
            `Mod: ${report.modDirectory}`,
            `Written: ${report.written.length ? report.written.join(", ") : "nothing new"}`,
            `Identical: ${report.identical.length}`,
            `Kept existing (differing): ${report.drifted.length ? `${report.drifted.join(", ")} (use --force to replace)` : "none"}`,
            ...(report.removed.length ? [`Removed stale files: ${report.removed.join(", ")}`] : []),
            `Layout ${report.layout.name}: ${report.layout.note}`,
            ...(report.layout.backup ? [`Backup: ${report.layout.backup}`] : []),
            `Mod check: ${report.check.ran ? (report.check.ok ? "passed" : `failed\n${report.check.output}`) : "skipped"}`,
          ];
          process.stdout.write(`${lines.join("\n")}\n`);
        }
        return report.check.ran && !report.check.ok ? 1 : 0;
      }
      case "state": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        const due = planDue(snapshot.records, Date.now());
        const reachable = await appReachable();
        const state = {
          store: schedulerDirectory(env),
          tasks: snapshot.records.length,
          due: due.dispatch.length,
          missed: due.missed.length,
          problems: snapshot.problems,
          herdrRunning: reachable,
        };
        if (json) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
        else {
          process.stdout.write(
            `store: ${state.store}\ntasks: ${state.tasks}\ndue now: ${state.due}\nmissed fixed runs: ${state.missed}\nHerdr app running: ${reachable ? "yes" : "no"}\n${state.problems.length ? `problems:\n  ${state.problems.join("\n  ")}\n` : ""}`,
          );
        }
        return 0;
      }
      case "list": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        if (json) process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
        else if (snapshot.records.length === 0) {
          process.stdout.write("No scheduled tasks. Install the mod and open Schedulers in Herdr, or add one here.\n");
        } else {
          const sorted = [...snapshot.records].sort((a, b) => (a.state.nextRunAt ?? Infinity) - (b.state.nextRunAt ?? Infinity));
          for (const record of sorted) process.stdout.write(`${describeTask(record)}\n\n`);
        }
        if (snapshot.problems.length) process.stderr.write(`problems:\n  ${snapshot.problems.join("\n  ")}\n`);
        return 0;
      }
      case "show": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        const needle = parsed.positionals[0];
        if (!needle) throw new Error("Say which task: show <id|name>.");
        const record = resolveOne(snapshot.records, needle);
        if (json) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
        else process.stdout.write(`${describeTask(record)}\n`);
        return 0;
      }
      case "add": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        const now = Date.now();
        const built = buildTask(inputFromFlags(parsed), now);
        if ("errors" in built) {
          process.stderr.write(`${Object.entries(built.errors).map(([field, message]) => `${field}: ${message}`).join("\n")}\n`);
          return 2;
        }
        if (findRecord(snapshot.records, built.task.id)) throw new Error("A task with that id already exists.");
        await saveTask(env, built.task, null);
        process.stdout.write(`Added ${built.task.name} (${built.task.id})\n`);
        return 0;
      }
      case "edit": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        if (!parsed.positionals[0]) throw new Error("Say which task to edit.");
        const record = resolveOne(snapshot.records, parsed.positionals[0]);
        const now = Date.now();
        const built = buildTask(inputFromFlags(parsed, record.task), now, record.task);
        if ("errors" in built) {
          process.stderr.write(`${Object.entries(built.errors).map(([field, message]) => `${field}: ${message}`).join("\n")}\n`);
          return 2;
        }
        await saveTask(env, built.task, record.taskRaw);
        process.stdout.write(`Saved ${built.task.name} (${built.task.id})\n`);
        return 0;
      }
      case "enable":
      case "pause": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        const record = resolveOne(snapshot.records, parsed.positionals[0] ?? "");
        const enabled = parsed.command === "enable";
        await changeTask(env, record.task.id, record.taskRaw, enabled ? "enable" : "pause");
        process.stdout.write(`${enabled ? "Enabled" : "Paused"} ${record.task.name}\n`);
        return 0;
      }
      case "rm": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        const record = resolveOne(snapshot.records, parsed.positionals[0] ?? "");
        await changeTask(env, record.task.id, record.taskRaw, "remove");
        process.stdout.write(`Removed ${record.task.name}\n`);
        return 0;
      }
      case "run": {
        const snapshot = await loadSnapshot(tasksDir, statesDir);
        const record = resolveOne(snapshot.records, parsed.positionals[0] ?? "");
        if (!record.task.enabled) throw new Error("Enable the task before running it.");
        if (!(await appReachable())) {
          throw new Error("Herdr is not running. The scheduler dispatches only while the app runs, so nothing was requested.");
        }
        await changeTask(env, record.task.id, record.taskRaw, "run");
        process.stdout.write(`Run requested for ${record.task.name}. The scheduler picks it up within a few seconds.\n`);
        return 0;
      }
      case "paths": {
        process.stdout.write(
          `${JSON.stringify(
            {
              store: schedulerDirectory(env),
              tasks: tasksDir,
              state: statesDir,
              locks: locksDirectory(env),
              example: { task: taskPath("task-id", env), state: statePath("task-id", env), lock: lockPath("task-id", env) },
            },
            null,
            2,
          )}\n`,
        );
        return 0;
      }
      default:
        process.stderr.write(`Unknown command "${parsed.command}".\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
