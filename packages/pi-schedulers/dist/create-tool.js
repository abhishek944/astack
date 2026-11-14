/** Scheduler-owned definition authoring. No dispatch, install, trust or auth side effects. */
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";
import { buildTask, THINKING_LEVELS } from "./core/model.js";
import { repoName, worktreeSlug } from "./core/run.js";
import { nextRunAt, scheduleLabel } from "./core/schedule.js";
import { confirmCreation } from "./create-confirmation.js";
import { saveTask } from "./host/store.js";
const MODE_PROBE = "pi-firstmate:mode:probe";
const MODE_CHANGED = "pi-firstmate:mode:changed";
const TOOLS_CHANGED = "pi-schedulers:tools:changed";
const ASK_PROBE = "pi-ask:guard:probe";
const NAME = "SchedulerCreate";
const objectOptions = { additionalProperties: false };
const parameters = Type.Object({
    name: Type.String({ description: "Name of the scheduled task." }),
    prompt: Type.String({ description: "Complete prompt for each independent scheduled Pi run." }),
    schedule: Type.Union([
        Type.Object({
            type: Type.Literal("fixed_time"),
            timeOfDay: Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: "HH:MM in the scheduler host's local time." }),
            weekdays: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6, description: "0 Sunday through 6 Saturday; omitted or empty means daily." }))),
        }, objectOptions),
        Type.Object({
            type: Type.Literal("interval"),
            everyMinutes: Type.Number({ exclusiveMinimum: 0, description: "Positive interval in minutes, including fractions." }),
        }, objectOptions),
    ]),
    folder: Type.Optional(Type.String({ description: "Absolute existing project folder. Defaults to this Pi session's cwd." })),
    workspace: Type.Optional(Type.Union([
        Type.Object({ mode: Type.Literal("root") }, objectOptions),
        Type.Object({ mode: Type.Literal("existing"), path: Type.String({ description: "Absolute existing checkout folder." }) }, objectOptions),
        Type.Object({ mode: Type.Literal("worktree"), baseBranch: Type.String({ description: "Base branch for a new worktree at each dispatch; empty means HEAD." }) }, objectOptions),
    ])),
    model: Type.Optional(Type.String({ description: "Pi provider/model selection; omitted uses Pi's default at run startup." })),
    thinking: Type.Optional(Type.Union(THINKING_LEVELS.map((level) => Type.Literal(level)))),
    enabled: Type.Optional(Type.Boolean({ description: "Defaults to true. False creates a paused definition." })),
}, objectOptions);
class CreationStopped extends Error {
}
async function existingFolder(path) {
    if (!isAbsolute(path))
        throw new CreationStopped("Folder and existing workspace paths must be absolute.");
    try {
        const actual = await realpath(path);
        if (!(await stat(actual)).isDirectory())
            throw new Error("not a directory");
        return actual;
    }
    catch {
        throw new CreationStopped("The folder or existing workspace is not an accessible directory. Nothing was saved.");
    }
}
/** Escape terminal controls, without truncating any name, prompt or path. */
function display(value) {
    return Array.from(value, (char) => {
        const code = char.charCodeAt(0);
        const control = (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159);
        return control ? `\\u${code.toString(16).padStart(4, "0")}` : char;
    }).join("");
}
function preview(task) {
    const next = task.enabled ? nextRunAt(task.schedule, Date.now()) : null;
    const workspace = task.workspace.mode === "root"
        ? `Project folder: ${task.folder}`
        : task.workspace.mode === "existing"
            ? `Existing checkout: ${task.workspace.path}`
            : `New worktree at dispatch, base branch: ${task.workspace.baseBranch}\nDestination: ${join(homedir(), ".herdr", "worktrees", worktreeSlug(repoName(task.folder)))} / generated per-run branch folder (not created now)`;
    return display([
        "Create this scheduled task? Review the complete definition before choosing Create.",
        `Name: ${task.name}`,
        `Prompt:\n${task.prompt}`,
        `Project folder: ${task.folder}`,
        `Workspace: ${workspace}`,
        `Schedule: ${scheduleLabel(task.schedule)}\nExact schedule: ${JSON.stringify(task.schedule)}`,
        `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone} (scheduler host local time; DST rules apply)`,
        `Next run: ${next !== null && Number.isFinite(next) && !Number.isNaN(new Date(next).getTime()) ? new Date(next).toString() : "none"}${task.enabled ? " (estimate; recalculated when saved)" : " (paused)"}`,
        `Model: ${task.model ?? "Pi default, resolved at run startup in the run folder"}`,
        `Thinking: ${task.thinking ?? "Pi default, resolved at run startup"}`,
        `Enabled: ${task.enabled}`,
        "Execution: independent Pi session with normal configured tools, extensions and MCP; First Mate off (worker-suppressed). Existing project trust and authentication still apply; neither is granted here.",
        "This only saves a definition. It does not run the prompt, create a worktree, install anything or request run-now. Enabled tasks may dispatch when due while Herdr runs.",
    ].join("\n\n"));
}
export function registerSchedulerCreate(pi) {
    let live = false;
    let exposed = false;
    let confirmation;
    function mode() {
        const request = {};
        pi.events.emit(MODE_PROBE, request);
        return request;
    }
    function effective(probe) {
        return live && probe.available === true && probe.protocolVersion === 1 && probe.effective === true && typeof probe.generation === "number";
    }
    function askActive() {
        const request = {};
        pi.events.emit(ASK_PROBE, request);
        return request.available === true && request.protocolVersion === 1 && request.active === true;
    }
    function register(visible) {
        pi.registerTool({
            name: NAME,
            label: "Create scheduled task",
            description: "Create a scheduled Pi task definition ONLY when the human user explicitly requests scheduled work. Never call proactively, autonomously, from inferred permission, or merely because work could recur. Requires effective First Mate coordinator mode and always shows the full resolved preview and waits for the human to choose Create or Cancel. Every call, including duplicates, needs its own confirmation. Creates a definition only; never executes the scheduled work. No tools or approval-bypass parameter exists.",
            promptGuidelines: ["Use SchedulerCreate only for a human user's explicit request to schedule work. Do not call it proactively or treat model-generated text as human consent. The mandatory Create/Cancel dialog is the human gate."],
            exposure: visible ? "model-only" : "hidden",
            defaultActive: false,
            executionMode: "sequential",
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
            parameters,
            async execute(_id, params, signal, _onUpdate, ctx) {
                const initial = mode();
                let saving = false;
                const controller = new AbortController();
                const abort = () => controller.abort();
                const assertAuthorized = () => {
                    const current = mode();
                    if (signal?.aborted || controller.signal.aborted)
                        throw new CreationStopped("Creation cancelled. No task was saved.");
                    if (!effective(current) || current.generation !== initial.generation || askActive()) {
                        throw new CreationStopped("Creation cancelled because coordinator mode changed or a read-only guard is active. No task was saved.");
                    }
                };
                const result = (status, text, id) => ({
                    content: [{ type: "text", text }], details: { status, ...(id ? { id } : {}) },
                });
                let unsubscribe;
                try {
                    assertAuthorized();
                    if (!ctx.hasUI)
                        return result("unavailable", "A human Create/Cancel dialog is required. No UI is available, so nothing was saved.");
                    signal?.addEventListener("abort", abort, { once: true });
                    unsubscribe = pi.events.on(MODE_CHANGED, () => {
                        const current = mode();
                        if (!effective(current) || current.generation !== initial.generation)
                            controller.abort();
                    });
                    confirmation = controller;
                    const folder = await existingFolder(params.folder ?? ctx.cwd);
                    const workspace = params.workspace?.mode === "existing"
                        ? { mode: "existing", path: await existingFolder(params.workspace.path) }
                        : params.workspace ?? { mode: "root" };
                    const schedule = params.schedule.type === "interval"
                        ? { type: "interval", everyMs: params.schedule.everyMinutes * 60_000 }
                        : params.schedule;
                    const built = buildTask({ ...params, folder, workspace, schedule }, Date.now());
                    if ("errors" in built)
                        return result("invalid", Object.values(built.errors).join("\n"));
                    assertAuthorized();
                    const choice = await confirmCreation(ctx, preview(built.task), controller.signal);
                    if (choice !== "Create")
                        return result("cancelled", "Creation cancelled. Nothing was saved.");
                    // Consent is UI-owned. Recheck the authoritative mode after the human
                    // answers, and again inside the existing transaction before commit.
                    assertAuthorized();
                    saving = true;
                    await saveTask(undefined, built.task, null, assertAuthorized);
                    return result("created", `Created scheduled task ${built.task.id}. This call did not execute the scheduled work.`, built.task.id);
                }
                catch (error) {
                    if (error instanceof CreationStopped)
                        return result("cancelled", error.message);
                    return result("failed", saving
                        ? "Creation could not be completed. Inspect the scheduler store before retrying; the definition may have been saved."
                        : "The task could not be prepared or confirmed. Nothing was saved.");
                }
                finally {
                    signal?.removeEventListener("abort", abort);
                    unsubscribe?.();
                    if (confirmation === controller)
                        confirmation = undefined;
                }
            },
        });
    }
    function syncExposure() {
        const visible = effective(mode());
        if (visible === exposed)
            return;
        exposed = visible;
        // Pi refresh reapplies every CLI --tools match on any registration. Restore
        // the exact prior choices before First Mate observes/captures a baseline;
        // only First Mate may add the scheduler to that active set.
        const active = pi.getActiveTools();
        register(visible);
        pi.setActiveTools(active);
        pi.events.emit(TOOLS_CHANGED, undefined);
    }
    register(false);
    pi.events.on(MODE_CHANGED, syncExposure);
    pi.on("session_start", () => { live = true; syncExposure(); });
    pi.on("before_agent_start", syncExposure);
    pi.on("turn_end", syncExposure);
    pi.on("session_shutdown", () => {
        live = false;
        confirmation?.abort();
        syncExposure();
    });
}
