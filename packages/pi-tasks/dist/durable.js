/**
 * Settings-only native Durable entrypoint for pi-tasks.
 *
 * `createTasksDurableExtension(settings)` returns a native Durable {@link Extension}
 * that registers real, working Work/Todo record tools. Records live in one
 * conversation-scoped Durable document (`pi-tasks.state`, `history: "latest"`,
 * `fork: "initial"`), so every conversation has isolated tracking and a fork starts
 * empty. All mutations go through atomic `api.commit()` transactions; the
 * invocation-bound `api` is never retained.
 *
 * Desktop-only surfaces are intentionally absent here, not stubbed:
 * - AgentCreate/List/Status/Output/Send/Interrupt/Close/Focus need the Herdr CLI
 *   plus Pi nested `executeTool`, which Durable 1.1 `ToolExecutionApi` does not expose.
 * - TaskTimeExport/Import need repository `var/` timing files plus a parent Pi session.
 * - Auto-continuation needs Pi's `agent_before_settle` boundary; the `/works`
 *   command and the TUI panel/overlay are desktop Pi surfaces.
 * - Effort timing (`working` selection, elapsed measurement) needs the Pi agent
 *   lifecycle that pauses timers at loop boundaries; no native equivalent exists, so
 *   the native schema carries no timing fields and reports no times rather than
 *   fabricated zeros. Desktop timing is unchanged.
 * - Durable 1.1 has no generic `executeTool`, and its `ToolTask` input requires an
 *   existing assistant entry, so no cross-tool bridge is fabricated.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import { defineDoc, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { taskOwner } from "./ownership.js";
import { safeSingleLine } from "./text.js";
const STATE_KIND = "pi-tasks.state";
const STATE_VERSION = 1;
const tasksDoc = defineDoc({
    kind: STATE_KIND,
    version: STATE_VERSION,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ works: [], todos: [], nextWorkId: 1, nextTaskId: 1 }),
});
const StatusSchema = StringEnum(["active", "blocked", "completed", "cancelled"]);
const InfoSchema = Type.String({ minLength: 1, maxLength: 10_000 });
const NameSchema = Type.String({ minLength: 1, maxLength: 240 });
const CompletionSchema = Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()]);
const BlockedReasonSchema = Type.Union([Type.String({ minLength: 1, maxLength: 10_000 }), Type.Null()]);
const MAX_TEXT_BYTES = 50_000;
const MAX_TEXT_LINES = 2_000;
function bounded(text) {
    const lines = text.split("\n");
    const clipped = lines.length > MAX_TEXT_LINES ? [...lines.slice(0, MAX_TEXT_LINES), "[Output truncated.]"] : lines;
    const joined = clipped.join("\n");
    return joined.length > MAX_TEXT_BYTES ? `${joined.slice(0, MAX_TEXT_BYTES)}\n[Output truncated.]` : joined;
}
function validLimit(value, fallback) {
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || value < 1 || value > 10_000) {
        throw new Error("Task limits must be integers from 1 to 10000.");
    }
    return value;
}
function requiredName(value) {
    const text = safeSingleLine(value);
    if (!text)
        throw new Error("Names must not be empty.");
    return text;
}
function requiredText(value) {
    const text = value.trim();
    if (!text)
        throw new Error("Details must not be empty.");
    return text;
}
function checkCompletion(status, value) {
    if (value === undefined || value === null)
        return;
    if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error("completionPercent must be an integer from 0 to 100, or null for unknown.");
    }
    if (value === 100 && status !== "completed") {
        throw new Error("100% requires verified completion. Set status to completed after verification.");
    }
    if (status === "completed" && value !== 100) {
        throw new Error("Completed tasks have 100% progress. Reopen the task before reporting partial progress.");
    }
}
/** Mirrors the desktop completion policy: completed is 100, missing estimates stay unknown. */
function taskCompletion(status, completionPercent) {
    if (status === "completed")
        return 100;
    return typeof completionPercent === "number" && Number.isInteger(completionPercent)
        && completionPercent >= 0 && completionPercent < 100 ? completionPercent : null;
}
function workCompletion(todos, workId) {
    const tasks = todos.filter((todo) => todo.workId === workId && todo.status !== "cancelled");
    if (tasks.length === 0)
        return null;
    let total = 0;
    for (const todo of tasks) {
        const value = taskCompletion(todo.status, todo.completionPercent);
        if (value === null)
            return null;
        total += value;
    }
    return Math.floor(total / tasks.length);
}
function formatCompletion(value) {
    return value === null ? "—" : `${value}%`;
}
function normalizeBlockedReason(status, supplied, current) {
    if (status !== "blocked") {
        if (supplied !== undefined && supplied !== null) {
            throw new Error("blockedReason is only valid for blocked tasks.");
        }
        return null;
    }
    if (supplied === undefined && current?.status === "blocked")
        return current.blockedReason;
    if (typeof supplied !== "string" || !supplied.trim()) {
        throw new Error("Blocked tasks require a nonempty blockedReason explaining the obstacle and what will allow work to resume.");
    }
    return supplied.trim();
}
function formatTodo(todo) {
    const owner = taskOwner(todo.taskInfo);
    const blocked = todo.status === "blocked" ? `\nBlocked reason: ${todo.blockedReason ?? "No reason recorded."}` : "";
    return `${todo.taskId} [${todo.status}] [${owner === "self" || owner === "delegate" ? owner : "unassigned"}] ${todo.taskName} · ${formatCompletion(taskCompletion(todo.status, todo.completionPercent))}\nWork: ${todo.workId}${blocked}\nTask info:\n${todo.taskInfo}`;
}
function formatWork(doc, work, filter) {
    const todos = doc.todos
        .filter((todo) => todo.workId === work.workId)
        .filter((todo) => !filter?.status || todo.status === filter.status);
    return [
        `${work.workId} ${work.workName} · ${formatCompletion(workCompletion(doc.todos, work.workId))}`,
        `Work info:\n${work.workInfo}`,
        todos.length ? `Todos:\n${todos.map((todo) => formatTodo(todo)).join("\n\n")}` : "Todos: none",
    ].join("\n");
}
/**
 * Create a native Work/Todo tracking extension from serializable settings.
 * The host opens its own Harness with models/storage/env and installs the result.
 * Record tools only: effort timing is unsupported natively (see module docs).
 */
export function createTasksDurableExtension(settings = {}) {
    const maxWorks = validLimit(settings.maxWorks, 100);
    const maxTodos = validLimit(settings.maxTodos, 500);
    const workCreate = defineTool({
        name: "WorkCreate",
        description: "Create a work collection: shared goal, context, and constraints for its todos. Works have no status; todos own status. Takes workName and detailed workInfo.",
        parameters: Type.Object({ workName: NameSchema, workInfo: InfoSchema }, { additionalProperties: false }),
        replay: "unsafe",
        executionMode: "sequential",
        async execute(args, api, context) {
            if (context.abortSignal?.aborted)
                throw new Error("WorkCreate aborted before its transaction.");
            const created = await api.commit(async (tx) => {
                const doc = await tx.doc(tasksDoc, api.conversationId);
                if (doc.works.length >= maxWorks)
                    throw new Error(`Maximum of ${maxWorks} works reached.`);
                const now = Date.now();
                const work = {
                    workId: `W${doc.nextWorkId}`,
                    workName: requiredName(args.workName),
                    workInfo: requiredText(args.workInfo),
                    createdAt: now,
                    updatedAt: now,
                };
                doc.works.push(work);
                doc.nextWorkId += 1;
                return { ...work };
            }, context);
            return {
                content: [{ type: "text", text: `Created work ${created.workId}: ${created.workName}` }],
                details: { workId: created.workId, workName: created.workName },
            };
        },
    });
    const workList = defineTool({
        name: "WorkList",
        description: "List works and their todos for this conversation. Optional workId filter and limit return the newest N matching works. Reports progress and status; effort timing is unsupported natively. Read-only.",
        parameters: Type.Object({
            workId: Type.Optional(Type.String()),
            limit: Type.Optional(Type.Integer({ minimum: 1 })),
        }, { additionalProperties: false }),
        replay: "safe",
        executionMode: "sequential",
        async execute(args, api, context) {
            const snapshot = await api.snapshot(tasksDoc, api.conversationId, context);
            const matches = (snapshot?.works ?? [])
                .filter((work) => args.workId === undefined || work.workId === args.workId)
                .sort((left, right) => left.createdAt - right.createdAt);
            const works = args.limit === undefined ? matches : matches.slice(-args.limit);
            const doc = snapshot ?? { works: [], todos: [], nextWorkId: 1, nextTaskId: 1 };
            const text = works.length === 0
                ? "No works found in this conversation."
                : works.map((work) => formatWork(doc, work)).join("\n\n---\n\n");
            return {
                content: [{ type: "text", text: bounded(`Showing ${works.length} of ${matches.length} matching works\n\n${text}`) }],
                details: { count: works.length, total: matches.length },
            };
        },
    });
    const workUpdate = defineTool({
        name: "WorkUpdate",
        description: "Update a work's name or shared context when scope or decisions change. Requires at least one changed field. Works have no status.",
        parameters: Type.Object({
            workId: Type.String({ minLength: 1 }),
            workName: Type.Optional(NameSchema),
            workInfo: Type.Optional(InfoSchema),
        }, { additionalProperties: false }),
        replay: "unsafe",
        executionMode: "sequential",
        async execute(args, api, context) {
            if (context.abortSignal?.aborted)
                throw new Error("WorkUpdate aborted before its transaction.");
            const updated = await api.commit(async (tx) => {
                const doc = await tx.doc(tasksDoc, api.conversationId);
                const work = doc.works.find((entry) => entry.workId === args.workId);
                if (!work)
                    throw new Error(`Work ${args.workId} not found in this conversation.`);
                let changed = false;
                if (args.workName !== undefined) {
                    const name = requiredName(args.workName);
                    if (name !== work.workName) {
                        work.workName = name;
                        changed = true;
                    }
                }
                if (args.workInfo !== undefined) {
                    const info = requiredText(args.workInfo);
                    if (info !== work.workInfo) {
                        work.workInfo = info;
                        changed = true;
                    }
                }
                if (!changed)
                    throw new Error("WorkUpdate requires at least one changed field.");
                work.updatedAt = Date.now();
                return { ...work };
            }, context);
            return {
                content: [{ type: "text", text: `Updated work ${updated.workId}: ${updated.workName}` }],
                details: { workId: updated.workId, workName: updated.workName },
            };
        },
    });
    const workDelete = defineTool({
        name: "WorkDelete",
        description: "Delete a work and every todo under it. Use only for explicit cancellation or mistaken entries.",
        parameters: Type.Object({ workId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        replay: "unsafe",
        executionMode: "sequential",
        async execute(args, api, context) {
            if (context.abortSignal?.aborted)
                throw new Error("WorkDelete aborted before its transaction.");
            const removed = await api.commit(async (tx) => {
                const doc = await tx.doc(tasksDoc, api.conversationId);
                const index = doc.works.findIndex((entry) => entry.workId === args.workId);
                if (index === -1)
                    throw new Error(`Work ${args.workId} not found in this conversation.`);
                const removedTodos = doc.todos.filter((todo) => todo.workId === args.workId);
                doc.todos = doc.todos.filter((todo) => todo.workId !== args.workId);
                const [work] = doc.works.splice(index, 1);
                if (!work)
                    throw new Error(`Work ${args.workId} is no longer available.`);
                return { workId: work.workId, todoCount: removedTodos.length };
            }, context);
            return {
                content: [{ type: "text", text: `Deleted work ${removed.workId} and ${removed.todoCount} associated todo${removed.todoCount === 1 ? "" : "s"}.` }],
                details: { workId: removed.workId, todoCount: removed.todoCount },
            };
        },
    });
    const todoCreate = defineTool({
        name: "TodoCreate",
        description: "Create one concrete todo under an existing work with detailed taskInfo. New tasks default to active. Supply blockedReason when creating a blocked task. completionPercent is an optional 0-100 estimate, null for unknown; 100 requires completed status.",
        parameters: Type.Object({
            workId: Type.String({ minLength: 1 }),
            taskName: NameSchema,
            taskInfo: InfoSchema,
            status: Type.Optional(StatusSchema),
            completionPercent: Type.Optional(CompletionSchema),
            blockedReason: Type.Optional(BlockedReasonSchema),
        }, { additionalProperties: false }),
        replay: "unsafe",
        executionMode: "sequential",
        async execute(args, api, context) {
            if (context.abortSignal?.aborted)
                throw new Error("TodoCreate aborted before its transaction.");
            const created = await api.commit(async (tx) => {
                const doc = await tx.doc(tasksDoc, api.conversationId);
                if (!doc.works.some((work) => work.workId === args.workId)) {
                    throw new Error(`Work ${args.workId} not found in this conversation.`);
                }
                if (doc.todos.length >= maxTodos)
                    throw new Error(`Maximum of ${maxTodos} todos reached.`);
                const status = (args.status ?? "active");
                checkCompletion(status, args.completionPercent ?? null);
                const now = Date.now();
                const todo = {
                    taskId: `T${doc.nextTaskId}`,
                    workId: args.workId,
                    taskName: requiredName(args.taskName),
                    taskInfo: requiredText(args.taskInfo),
                    status,
                    blockedReason: normalizeBlockedReason(status, args.blockedReason ?? undefined, undefined),
                    completionPercent: status === "completed" ? 100 : (args.completionPercent ?? null),
                    createdAt: now,
                    updatedAt: now,
                };
                doc.todos.push(todo);
                doc.nextTaskId += 1;
                return { ...todo };
            }, context);
            return {
                content: [{ type: "text", text: `Created todo ${created.taskId} under ${created.workId}: ${created.taskName} [${created.status}]` }],
                details: { taskId: created.taskId, workId: created.workId, status: created.status },
            };
        },
    });
    const todoList = defineTool({
        name: "TodoList",
        description: "List todos for this conversation, with progress and status. Effort timing is unsupported natively. Optional taskId, workId, status, and limit filters. Read-only.",
        parameters: Type.Object({
            taskId: Type.Optional(Type.String()),
            workId: Type.Optional(Type.String()),
            status: Type.Optional(StatusSchema),
            limit: Type.Optional(Type.Integer({ minimum: 1 })),
        }, { additionalProperties: false }),
        replay: "safe",
        executionMode: "sequential",
        async execute(args, api, context) {
            const snapshot = await api.snapshot(tasksDoc, api.conversationId, context);
            const matches = (snapshot?.todos ?? [])
                .filter((todo) => args.taskId === undefined || todo.taskId === args.taskId)
                .filter((todo) => args.workId === undefined || todo.workId === args.workId)
                .filter((todo) => args.status === undefined || todo.status === args.status)
                .sort((left, right) => left.createdAt - right.createdAt);
            const todos = args.limit === undefined ? matches : matches.slice(-args.limit);
            const text = todos.length === 0
                ? "No todos found."
                : todos.map((todo) => formatTodo(todo)).join("\n\n");
            return {
                content: [{ type: "text", text: bounded(`Showing ${todos.length} of ${matches.length} matching todos\n\n${text}`) }],
                details: { count: todos.length, total: matches.length },
            };
        },
    });
    const todoUpdate = defineTool({
        name: "TodoUpdate",
        description: "Update a todo's name, details, status, progress, or blocked reason. Requires at least one changed field. Completion follows: 100 only with completed status; reopening a completed task without a fresh estimate resets progress to unknown. Effort timing is unsupported natively: there is no working field.",
        parameters: Type.Object({
            taskId: Type.String({ minLength: 1 }),
            taskName: Type.Optional(NameSchema),
            taskInfo: Type.Optional(InfoSchema),
            status: Type.Optional(StatusSchema),
            completionPercent: Type.Optional(CompletionSchema),
            blockedReason: Type.Optional(BlockedReasonSchema),
        }, { additionalProperties: false }),
        replay: "unsafe",
        executionMode: "sequential",
        async execute(args, api, context) {
            if (context.abortSignal?.aborted)
                throw new Error("TodoUpdate aborted before its transaction.");
            const updated = await api.commit(async (tx) => {
                const doc = await tx.doc(tasksDoc, api.conversationId);
                const todo = doc.todos.find((entry) => entry.taskId === args.taskId);
                if (!todo)
                    throw new Error(`Todo ${args.taskId} not found in this conversation.`);
                const oldStatus = todo.status;
                const status = (args.status ?? oldStatus);
                checkCompletion(status, args.completionPercent);
                // Validate the reason transition before mutating anything: entering blocked
                // without a reason is rejected, and leaving blocked always clears the reason.
                const transitioned = args.status !== undefined && args.status !== oldStatus;
                const reason = (args.blockedReason !== undefined || transitioned)
                    ? normalizeBlockedReason(status, args.blockedReason ?? undefined, transitioned ? undefined : todo)
                    : todo.blockedReason;
                let changed = false;
                if (args.taskName !== undefined) {
                    const name = requiredName(args.taskName);
                    if (name !== todo.taskName) {
                        todo.taskName = name;
                        changed = true;
                    }
                }
                if (args.taskInfo !== undefined) {
                    const info = requiredText(args.taskInfo);
                    if (info !== todo.taskInfo) {
                        todo.taskInfo = info;
                        changed = true;
                    }
                }
                if (transitioned) {
                    todo.status = status;
                    changed = true;
                }
                if (reason !== todo.blockedReason) {
                    todo.blockedReason = reason;
                    changed = true;
                }
                if (args.completionPercent !== undefined && args.completionPercent !== todo.completionPercent) {
                    todo.completionPercent = args.completionPercent;
                    changed = true;
                }
                // Reopening a completed task without a fresh estimate resets progress to unknown.
                if (oldStatus === "completed" && status !== "completed" && args.completionPercent === undefined && todo.completionPercent !== null) {
                    todo.completionPercent = null;
                    changed = true;
                }
                if (status === "completed" && todo.completionPercent !== 100) {
                    todo.completionPercent = 100;
                    changed = true;
                }
                if (!changed) {
                    throw new Error("TodoUpdate requires at least one changed field.");
                }
                todo.updatedAt = Date.now();
                return {
                    taskId: todo.taskId,
                    workId: todo.workId,
                    status: todo.status,
                    completionPercent: taskCompletion(todo.status, todo.completionPercent),
                };
            }, context);
            return {
                content: [{ type: "text", text: `Updated todo ${updated.taskId}: [${updated.status}] · ${formatCompletion(updated.completionPercent)}` }],
                details: { ...updated },
            };
        },
    });
    const todoDelete = defineTool({
        name: "TodoDelete",
        description: "Delete a todo from its work. Use only for explicit cancellation, scope removal, or mistaken entries.",
        parameters: Type.Object({ taskId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        replay: "unsafe",
        executionMode: "sequential",
        async execute(args, api, context) {
            if (context.abortSignal?.aborted)
                throw new Error("TodoDelete aborted before its transaction.");
            const removed = await api.commit(async (tx) => {
                const doc = await tx.doc(tasksDoc, api.conversationId);
                const index = doc.todos.findIndex((entry) => entry.taskId === args.taskId);
                if (index === -1)
                    throw new Error(`Todo ${args.taskId} not found in this conversation.`);
                const [todo] = doc.todos.splice(index, 1);
                if (!todo)
                    throw new Error(`Todo ${args.taskId} is no longer available.`);
                return { taskId: todo.taskId, taskName: todo.taskName };
            }, context);
            return {
                content: [{ type: "text", text: `Deleted todo ${removed.taskId}: ${removed.taskName}` }],
                details: { taskId: removed.taskId },
            };
        },
    });
    return defineExtension({
        name: "tasks",
        tools: [workCreate, workList, workUpdate, workDelete, todoCreate, todoList, todoUpdate, todoDelete],
    });
}
