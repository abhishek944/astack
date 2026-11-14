/**
 * Task mutations share an exclusive file lock with the Herdr mod. The complete
 * current-state decision and writes run inside it; rename alone is not CAS.
 * Locks never expire: an interrupted owner needs manual inspection, not a lease.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { emptyState, parseState, parseTask, serializeState, serializeTask, } from "../core/model.js";
import { reconcileState, requestRun, setEnabledState, stateAfterEdit } from "../core/transitions.js";
import { claimsDirectory, lockPath, locksDirectory, schedulerDirectory, statePath, statesDirectory, taskPath, tasksDirectory } from "./paths.js";
export async function readTextOrNull(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
}
/** Create the directories an install makes; a partially installed store is an error, not an empty one. */
export async function ensureStoreDirectories(env) {
    for (const directory of [schedulerDirectory(env), tasksDirectory(env), statesDirectory(env), claimsDirectory(env), locksDirectory(env)]) {
        await mkdir(directory, { recursive: true });
    }
}
export async function loadSnapshot(tasksDir, statesDir) {
    let names;
    try {
        names = await readdir(tasksDir);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`The scheduler store is missing at ${tasksDir}. Run "pi-schedulers install", or /schedulers install in Pi.`);
        }
        throw error;
    }
    const records = [];
    const problems = [];
    for (const name of names.sort()) {
        if (!name.endsWith(".json") || name.startsWith("."))
            continue;
        const id = basename(name, ".json");
        try {
            const taskRaw = await readTextOrNull(join(tasksDir, name));
            if (taskRaw === null)
                continue;
            const parsedTask = parseTask(JSON.parse(taskRaw));
            if ("error" in parsedTask) {
                problems.push(`${name}: ${parsedTask.error}`);
                continue;
            }
            if (parsedTask.task.id !== id) {
                problems.push(`${name}: the task id does not match its file name.`);
                continue;
            }
            const stateRaw = await readTextOrNull(join(statesDir, name));
            let state;
            if (stateRaw === null)
                state = emptyState();
            else {
                const parsedState = parseState(JSON.parse(stateRaw));
                if ("error" in parsedState) {
                    problems.push(`${name}: ${parsedState.error}`);
                    continue;
                }
                state = parsedState.state;
            }
            const lock = join(dirname(tasksDir), "locks", `${id}.json`);
            if (await readTextOrNull(lock) !== null)
                problems.push(`${name}: ownership lock present (active or interrupted). It never expires; inspect persistent locks only after all scheduler owners stop.`);
            else if (state.lastRunStatus === "running")
                problems.push(`${name}: unfinished dispatch; automatic interrupted-owner recovery is unsupported. Inspect acceptance before manual repair.`);
            records.push({ task: parsedTask.task, state: reconcileState(parsedTask.task, state, Date.now()), taskRaw, stateRaw });
        }
        catch (error) {
            problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { records, problems };
}
/** @internal Shared with the legacy importer; only the exclusive creator unlinks. */
export async function withTaskLock(env, id, action) {
    await mkdir(locksDirectory(env), { recursive: true });
    const path = lockPath(id, env);
    try {
        await writeFile(path, `${JSON.stringify({ owner: "node", pid: process.pid, at: Date.now() })}\n`, { flag: "wx" });
    }
    catch (error) {
        if (error.code === "EEXIST") {
            throw new Error(`Task is busy or has an interrupted owner (${path}). Nothing changed. Retry after dispatch; if it persists, inspect only after all scheduler owners stop.`);
        }
        throw error;
    }
    try {
        return await action();
    }
    finally {
        await unlink(path);
    }
}
/** Atomic replacement for cooperating writers already holding the task lock. */
async function writeAtomic(path, text, beforeWrite) {
    beforeWrite?.();
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${randomBytes(6).toString("hex")}`;
    try {
        beforeWrite?.();
        await writeFile(temporary, text, "utf8");
        beforeWrite?.();
        await rename(temporary, path);
    }
    finally {
        await unlink(temporary).catch((error) => {
            if (error.code !== "ENOENT")
                throw error;
        });
    }
}
async function currentEntry(env, id, expectedTaskRaw) {
    const taskRaw = await readTextOrNull(taskPath(id, env));
    if (taskRaw !== expectedTaskRaw)
        throw new Error("That task changed or was deleted. Reload before saving again.");
    if (taskRaw === null)
        return null;
    const parsedTask = parseTask(JSON.parse(taskRaw));
    if ("error" in parsedTask)
        throw new Error(parsedTask.error);
    if (parsedTask.task.id !== id)
        throw new Error("The task id does not match its file name.");
    const stateRaw = await readTextOrNull(statePath(id, env));
    const parsedState = parseState(stateRaw === null ? emptyState() : JSON.parse(stateRaw));
    if ("error" in parsedState)
        throw new Error(parsedState.error);
    return { task: parsedTask.task, state: reconcileState(parsedTask.task, parsedState.state, Date.now()), taskRaw, stateRaw };
}
/**
 * Save a definition, deriving its schedule transition from untouched current state.
 * An optional synchronous authorization guard runs before I/O and before the
 * definition write/commit. Once committed, the transaction finishes its state.
 */
export async function saveTask(env, task, expectedTaskRaw, beforeWrite) {
    beforeWrite?.();
    await withTaskLock(env, task.id, async () => {
        const previous = await currentEntry(env, task.id, expectedTaskRaw);
        const nextState = stateAfterEdit(previous, task, Date.now());
        await writeAtomic(taskPath(task.id, env), serializeTask(task), beforeWrite);
        if (!previous || serializeState(previous.state) !== serializeState(nextState)) {
            await writeAtomic(statePath(task.id, env), serializeState(nextState));
        }
    });
}
/** Apply only this author's intent to the latest state under the shared lock. */
export async function changeTask(env, id, expectedTaskRaw, operation) {
    await withTaskLock(env, id, async () => {
        const current = await currentEntry(env, id, expectedTaskRaw);
        if (!current)
            throw new Error("That task was deleted.");
        if (operation === "remove") {
            for (const path of [taskPath(id, env), statePath(id, env)]) {
                await unlink(path).catch((error) => {
                    if (error.code !== "ENOENT")
                        throw error;
                });
            }
            return;
        }
        const now = Date.now();
        if (operation === "run") {
            if (!current.task.enabled)
                throw new Error("Enable the task before running it.");
            await writeAtomic(statePath(id, env), serializeState(requestRun(current.state, now)));
            return;
        }
        const enabled = operation === "enable";
        const task = { ...current.task, enabled, updatedAt: now };
        const state = setEnabledState(current.state, task, enabled, now);
        await writeAtomic(taskPath(id, env), serializeTask(task));
        if (serializeState(current.state) !== serializeState(state))
            await writeAtomic(statePath(id, env), serializeState(state));
    });
}
