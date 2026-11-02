import { readFileSync } from "node:fs";
import { taskOwner } from "./ownership.js";
import { taskCompletion } from "./progress.js";
import { emptySnapshot, readSnapshot, taskSnapshotPath, writeSnapshot } from "./snapshot.js";
import { safeSingleLine } from "./text.js";
/** Legacy session entries are read once for migration, never written again. */
export const TASK_ENTRY_TYPE = "pi-tasks-state";
export const MAX_WORKS = 100;
export const MAX_TODOS = 500;
/** File-backed session state. Only the binding lives here, never an authoritative record cache. */
export class TaskState {
    onChange;
    binding;
    constructor(_pi, onChange) {
        this.onChange = onChange;
    }
    get snapshotPath() {
        if (!this.binding)
            throw new Error("Task storage is not initialized for a Pi session.");
        return this.binding.path;
    }
    restore(ctx, freshFork = false) {
        const previous = this.binding;
        this.binding = undefined;
        const sessionId = ctx.sessionManager.getSessionId();
        const path = taskSnapshotPath(sessionId);
        const existing = readSnapshot(path, sessionId);
        if (!existing && previous?.sessionId === sessionId)
            throw new Error("The session task snapshot disappeared. Restore it before continuing; it will not be recreated from conversation history.");
        const snapshot = existing ?? emptySnapshot(sessionId, ctx.cwd);
        if (!existing && !freshFork) {
            // Import the old selected view exactly once. From now on tree navigation
            // never replays history. New fork identities never inherit parent tasks.
            for (const entry of legacyEntries(ctx)) {
                if (entry.type !== "custom" || entry.customType !== TASK_ENTRY_TYPE)
                    continue;
                const event = parseEvent(entry.data);
                if (!event)
                    continue;
                try {
                    applyEvent(snapshot, event);
                }
                catch { /* Keep malformed legacy entries out of the migrated view. */ }
            }
        }
        snapshot.cwd = ctx.cwd;
        const terminalId = process.env.HC_TERMINAL_ID;
        snapshot.terminalId = terminalId && /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?t[0-9a-z]+$/.test(terminalId) ? terminalId : undefined;
        // A resumed process cannot measure the previous process's unfinished interval.
        snapshot.agentRunning = false;
        snapshot.focusedTaskId = undefined;
        for (const todo of snapshot.todos)
            delete todo.workingSince;
        snapshot.updatedAt = Date.now();
        writeSnapshot(path, snapshot);
        this.binding = { sessionId, path };
        this.onChange();
    }
    read() {
        if (!this.binding)
            throw new Error("Task storage is not initialized for a Pi session.");
        const snapshot = readSnapshot(this.binding.path, this.binding.sessionId);
        if (!snapshot)
            throw new Error("The session task snapshot is missing. Restore the file before continuing.");
        return snapshot;
    }
    change(update) {
        const snapshot = this.read();
        const result = update(snapshot);
        snapshot.updatedAt = Date.now();
        writeSnapshot(this.snapshotPath, snapshot);
        this.onChange();
        return result;
    }
    listWorks(filter) {
        const snapshot = this.read();
        return snapshot.works.filter((work) => !filter?.workId || work.workId === filter.workId)
            .sort((left, right) => left.createdAt - right.createdAt)
            .map((work) => ({ ...work, tasks: snapshot.todos.filter((todo) => todo.workId === work.workId).sort((left, right) => left.createdAt - right.createdAt) }));
    }
    listTodos(filter) {
        return this.read().todos
            .filter((todo) => !filter?.taskId || todo.taskId === filter.taskId)
            .filter((todo) => !filter?.workId || todo.workId === filter.workId)
            .filter((todo) => !filter?.status || todo.status === filter.status)
            .sort((left, right) => left.createdAt - right.createdAt);
    }
    getWork(workId) { return this.read().works.find((work) => work.workId === workId); }
    getTodo(taskId) { return this.read().todos.find((todo) => todo.taskId === taskId); }
    setAgentRunning(running) {
        // Timing hooks run before storage initialization and after failed startup too.
        if (!this.binding)
            return;
        if (this.read().agentRunning === running)
            return;
        this.change((snapshot) => {
            if (!running)
                saveInterval(snapshot);
            snapshot.agentRunning = running;
            const todo = snapshot.todos.find((todo) => todo.taskId === snapshot.focusedTaskId);
            if (running && todo)
                todo.workingSince = Date.now();
        });
    }
    setWorking(taskId, working) {
        this.change((snapshot) => selectWorking(snapshot, taskId, working));
    }
    clearWorking() {
        if (!this.binding)
            return;
        if (!this.read().focusedTaskId)
            return;
        this.change((snapshot) => { saveInterval(snapshot); delete snapshot.focusedTaskId; });
    }
    createWork(workName, workInfo) {
        return this.change((snapshot) => {
            if (snapshot.works.length >= MAX_WORKS)
                throw new Error(`Maximum of ${MAX_WORKS} works reached.`);
            const now = Date.now();
            const work = { workId: `W${snapshot.nextWorkId++}`, workName: requiredName(workName, "workName"), workInfo: requiredText(workInfo, "workInfo"), createdAt: now, updatedAt: now };
            snapshot.works.push(work);
            return work;
        });
    }
    updateWork(workId, patch) {
        return this.change((snapshot) => {
            const work = snapshot.works.find((work) => work.workId === workId);
            if (!work)
                throw new Error(`Work ${workId} not found.`);
            const normalized = compactPatch({ workName: patch.workName === undefined ? undefined : requiredName(patch.workName, "workName"), workInfo: patch.workInfo === undefined ? undefined : requiredText(patch.workInfo, "workInfo") });
            if (Object.keys(normalized).length === 0)
                throw new Error("WorkUpdate requires at least one changed field.");
            Object.assign(work, normalized, { updatedAt: Date.now() });
            return work;
        });
    }
    deleteWork(workId) {
        return this.change((snapshot) => {
            if (!snapshot.works.some((work) => work.workId === workId))
                return false;
            if (snapshot.todos.some((todo) => todo.workId === workId && todo.taskId === snapshot.focusedTaskId)) {
                saveInterval(snapshot);
                delete snapshot.focusedTaskId;
            }
            snapshot.works = snapshot.works.filter((work) => work.workId !== workId);
            snapshot.todos = snapshot.todos.filter((todo) => todo.workId !== workId);
            return true;
        });
    }
    createTodo(workId, taskName, taskInfo, status = "active", completionPercent, blockedReason) {
        return this.change((snapshot) => {
            if (!snapshot.works.some((work) => work.workId === workId))
                throw new Error(`Work ${workId} not found.`);
            if (snapshot.todos.length >= MAX_TODOS)
                throw new Error(`Maximum of ${MAX_TODOS} todos reached.`);
            validateCompletion(status, completionPercent);
            const now = Date.now();
            const todo = { taskId: `T${snapshot.nextTaskId++}`, workId, taskName: requiredName(taskName, "taskName"), taskInfo: requiredText(taskInfo, "taskInfo"), status,
                blockedReason: normalizeBlockedReason(status, blockedReason, undefined), completionPercent: status === "completed" ? 100 : completionPercent ?? null, elapsedMs: 0, createdAt: now, updatedAt: now };
            snapshot.todos.push(todo);
            return todo;
        });
    }
    updateTodo(taskId, patch) {
        return this.change((snapshot) => {
            const current = snapshot.todos.find((todo) => todo.taskId === taskId);
            if (!current)
                throw new Error(`Todo ${taskId} not found.`);
            const status = patch.status ?? current.status;
            validateCompletion(status, patch.completionPercent);
            const blockedReason = normalizeBlockedReason(status, patch.blockedReason, current);
            const normalized = compactPatch({
                taskName: patch.taskName === undefined ? undefined : requiredName(patch.taskName, "taskName"),
                taskInfo: patch.taskInfo === undefined ? undefined : requiredText(patch.taskInfo, "taskInfo"),
                status: patch.status,
                blockedReason: patch.blockedReason !== undefined || status !== current.status ? blockedReason : undefined,
                completionPercent: patch.completionPercent,
            });
            if (Object.keys(normalized).length === 0 && patch.working === undefined)
                throw new Error("TodoUpdate requires at least one changed field.");
            const effective = { ...current, ...normalized };
            const canWork = effective.status === "active" && taskOwner(effective.taskInfo) === "self";
            if (patch.working === true && !canWork)
                throw new Error("working=true requires an active task with owner: self in this session.");
            if (snapshot.focusedTaskId === taskId && (!canWork || patch.working === false)) {
                saveInterval(snapshot);
                delete snapshot.focusedTaskId;
            }
            Object.assign(current, normalized, { updatedAt: Date.now() });
            current.completionPercent = taskCompletion(current);
            if (patch.working !== undefined)
                selectWorking(snapshot, taskId, patch.working);
            return current;
        });
    }
    setDelegatedTime(taskId, source) {
        this.change((snapshot) => {
            const todo = snapshot.todos.find((todo) => todo.taskId === taskId);
            if (!todo || taskOwner(todo.taskInfo) !== "delegate")
                throw new Error("Delegated timing requires an existing owner: delegate task.");
            if (!validDelegatedTime(source))
                throw new Error("Invalid delegated timing source.");
            const previous = todo.delegatedTimes?.find((entry) => entry.reportPath === source.reportPath);
            if (previous?.workerSessionId && previous.workerSessionId !== source.workerSessionId)
                throw new Error("Timing report belongs to another worker session.");
            todo.delegatedTimes = [...(todo.delegatedTimes ?? []).filter((entry) => entry.reportPath !== source.reportPath), { ...source }];
        });
    }
    deleteTodo(taskId) {
        return this.change((snapshot) => {
            if (!snapshot.todos.some((todo) => todo.taskId === taskId))
                return false;
            if (snapshot.focusedTaskId === taskId) {
                saveInterval(snapshot);
                delete snapshot.focusedTaskId;
            }
            snapshot.todos = snapshot.todos.filter((todo) => todo.taskId !== taskId);
            return true;
        });
    }
}
function saveInterval(snapshot) {
    const todo = snapshot.todos.find((todo) => todo.taskId === snapshot.focusedTaskId);
    if (!todo || todo.workingSince === undefined)
        return;
    todo.elapsedMs = (todo.elapsedMs ?? 0) + Math.max(0, Date.now() - todo.workingSince);
    delete todo.workingSince;
}
function selectWorking(snapshot, taskId, working) {
    const todo = snapshot.todos.find((todo) => todo.taskId === taskId);
    if (!todo)
        throw new Error(`Todo ${taskId} not found.`);
    if (!working) {
        if (snapshot.focusedTaskId === taskId) {
            saveInterval(snapshot);
            delete snapshot.focusedTaskId;
        }
        return;
    }
    if (todo.status !== "active" || taskOwner(todo.taskInfo) !== "self")
        throw new Error("working=true requires an active task with owner: self in this session.");
    if (snapshot.focusedTaskId === taskId)
        return;
    saveInterval(snapshot);
    snapshot.focusedTaskId = taskId;
    todo.elapsedMs ??= 0;
    if (snapshot.agentRunning)
        todo.workingSince = Date.now();
}
/** CLI --fork starts with reason startup too. Copied legacy entries alone are
 * not this new session's tasks. A pre-upgrade fork with its own task edits still
 * imports its old view, including the ancestors those edits depended on. */
function legacyEntries(ctx) {
    const entries = ctx.sessionManager.getBranch();
    const tasks = entries.filter((entry) => entry.type === "custom" && entry.customType === TASK_ENTRY_TYPE);
    const parent = ctx.sessionManager.getHeader()?.parentSession;
    if (!parent || tasks.length === 0)
        return entries;
    const inherited = new Set();
    let contents;
    try {
        contents = readFileSync(parent, "utf8");
    }
    catch {
        throw new Error("Cannot distinguish inherited legacy tasks in this fork: restore its parent session file before migrating. Existing task history has not been changed.");
    }
    for (const line of contents.split("\n")) {
        if (!line.includes(TASK_ENTRY_TYPE))
            continue;
        try {
            const entry = JSON.parse(line);
            if (entry?.type === "custom" && entry.customType === TASK_ENTRY_TYPE)
                inherited.add(`${entry.id}:${entry.timestamp}`);
        }
        catch { /* A malformed parent line cannot be a valid inherited task event. */ }
    }
    return tasks.some((entry) => !inherited.has(`${entry.id}:${entry.timestamp}`)) ? entries : [];
}
/** Compatibility reducer used only when a session has no JSON task store yet. */
function applyEvent(snapshot, event) {
    switch (event.type) {
        case "work-created": {
            assertId(event.work.workId, "W");
            const work = { workId: event.work.workId, workName: requiredName(event.work.workName, "workName"), workInfo: requiredText(event.work.workInfo, "workInfo"), createdAt: event.work.createdAt, updatedAt: event.work.updatedAt };
            snapshot.works = [...snapshot.works.filter((item) => item.workId !== work.workId), work];
            snapshot.nextWorkId = Math.max(snapshot.nextWorkId, Number(work.workId.slice(1)) + 1);
            break;
        }
        case "work-updated": {
            const work = snapshot.works.find((work) => work.workId === event.workId);
            if (work)
                Object.assign(work, compactPatch({ workName: typeof event.patch.workName === "string" ? requiredName(event.patch.workName, "workName") : undefined, workInfo: event.patch.workInfo }), { updatedAt: event.at });
            break;
        }
        case "work-deleted":
            snapshot.works = snapshot.works.filter((work) => work.workId !== event.workId);
            snapshot.todos = snapshot.todos.filter((todo) => todo.workId !== event.workId);
            break;
        case "todo-created": {
            assertId(event.todo.taskId, "T");
            const status = restoredStatus(event.todo.status);
            if (!status)
                throw new Error("Malformed legacy task status.");
            const todo = { ...event.todo, taskName: requiredName(event.todo.taskName, "taskName"), taskInfo: requiredText(event.todo.taskInfo, "taskInfo"), status,
                blockedReason: status === "blocked" ? restoredReason(event.todo.blockedReason) : null,
                completionPercent: taskCompletion({ ...event.todo, status }), elapsedMs: validElapsed(event.todo.elapsedMs) ? event.todo.elapsedMs : null, delegatedTimes: undefined, workingSince: undefined };
            if (snapshot.works.some((work) => work.workId === todo.workId))
                snapshot.todos = [...snapshot.todos.filter((item) => item.taskId !== todo.taskId), todo];
            snapshot.nextTaskId = Math.max(snapshot.nextTaskId, Number(todo.taskId.slice(1)) + 1);
            break;
        }
        case "todo-updated": {
            const todo = snapshot.todos.find((todo) => todo.taskId === event.taskId);
            if (!todo)
                break;
            const patch = event.patch;
            const status = restoredStatus(patch.status) ?? todo.status;
            Object.assign(todo, compactPatch({ taskName: typeof patch.taskName === "string" ? requiredName(patch.taskName, "taskName") : undefined, taskInfo: patch.taskInfo, completionPercent: patch.completionPercent }), {
                status, blockedReason: status === "blocked" ? patch.blockedReason !== undefined ? restoredReason(patch.blockedReason) : todo.blockedReason : null, updatedAt: event.at,
            });
            todo.completionPercent = taskCompletion(todo);
            break;
        }
        case "todo-time": {
            const todo = snapshot.todos.find((todo) => todo.taskId === event.taskId);
            if (todo && validElapsed(event.elapsedMs))
                todo.elapsedMs = event.elapsedMs;
            break;
        }
        case "todo-delegated-time": {
            const todo = snapshot.todos.find((todo) => todo.taskId === event.taskId);
            if (todo && validDelegatedTime(event.source))
                todo.delegatedTimes = [...(todo.delegatedTimes ?? []).filter((source) => source.reportPath !== event.source.reportPath), { ...event.source }];
            break;
        }
        case "todo-deleted":
            snapshot.todos = snapshot.todos.filter((todo) => todo.taskId !== event.taskId);
            break;
    }
}
function restoredReason(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function normalizeBlockedReason(status, supplied, current) {
    if (status !== "blocked") {
        if (supplied !== undefined && supplied !== null)
            throw new Error("blockedReason is only valid for blocked tasks.");
        return null;
    }
    if (supplied === undefined && current?.status === "blocked")
        return current.blockedReason ?? null;
    if (typeof supplied !== "string" || !supplied.trim())
        throw new Error("Blocked tasks require a nonempty blockedReason explaining the obstacle and what will allow work to resume.");
    const reason = supplied.trim();
    if (reason.length > 10_000)
        throw new Error("blockedReason must not exceed 10000 characters.");
    return reason;
}
function validDelegatedTime(value) {
    return !!value && typeof value.reportPath === "string" && value.reportPath.length > 0
        && (value.elapsedMs === null || validElapsed(value.elapsedMs))
        && (value.workerSessionId === undefined || (typeof value.workerSessionId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.workerSessionId)));
}
function validElapsed(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function validateCompletion(status, value) {
    if (value === undefined || value === null)
        return;
    if (!Number.isInteger(value) || value < 0 || value > 100)
        throw new Error("completionPercent must be an integer from 0 to 100, or null for unknown.");
    if (value === 100 && status !== "completed")
        throw new Error("100% requires verified completion. Set status to completed after verification.");
    if (status === "completed" && value !== 100)
        throw new Error("Completed tasks have 100% progress. Reopen the task before reporting partial progress.");
}
function requiredText(value, field) {
    const text = value.trim();
    if (!text)
        throw new Error(`${field} must not be empty.`);
    return text;
}
function requiredName(value, field) {
    const text = safeSingleLine(value);
    if (!text)
        throw new Error(`${field} must not be empty.`);
    return text;
}
function compactPatch(patch) { return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)); }
function assertId(id, prefix) {
    if (typeof id !== "string" || !new RegExp(`^${prefix}[1-9]\\d*$`).test(id) || !Number.isSafeInteger(Number(id.slice(1))))
        throw new Error(`Malformed ${prefix === "W" ? "work" : "todo"} ID.`);
}
function restoredStatus(value) {
    if (value === "planned" || value === "pending")
        return "active";
    if (value === "active" || value === "blocked" || value === "completed" || value === "cancelled")
        return value;
    return undefined;
}
function parseEvent(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const candidate = value;
    if (candidate.version !== 1 || typeof candidate.type !== "string")
        return undefined;
    if (!["work-created", "work-updated", "work-deleted", "todo-created", "todo-updated", "todo-deleted", "todo-time", "todo-delegated-time"].includes(candidate.type))
        return undefined;
    return value;
}
