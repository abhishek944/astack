import { Type } from "typebox";
import { checkAnswer, findState, loadState, stopOwnedChildren, submissionResult, submitQuestion, watcherCommand, } from "./core.js";
import { optionalJson } from "./model.js";
const block = Type.Union([
    Type.Object({ type: Type.Literal("text"), text: Type.String() }, { additionalProperties: false }),
    Type.Object({
        type: Type.Literal("image"),
        path: Type.String({ description: "Complete absolute filesystem path" }),
        alt: Type.String(),
        caption: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    Type.Object({
        type: Type.Literal("video"),
        path: Type.String({
            description: "Complete absolute filesystem path to MP4 or WebM",
        }),
        caption: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    Type.Object({
        type: Type.Literal("mermaid"),
        code: Type.String(),
        caption: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
]);
const common = {
    questionId: Type.String(),
    question: Type.String(),
    label: Type.Optional(Type.String()),
};
// The shared core also validates mode-specific requirements for CLI callers.
const submission = Type.Object({
    ...common,
    mode: Type.Union([
        Type.Literal("single"),
        Type.Literal("multiple"),
        Type.Literal("review"),
    ]),
    content: Type.Optional(Type.Array(block)),
    options: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        label: Type.String(),
        content: Type.Optional(Type.Array(block)),
    }, { additionalProperties: false }))),
    recommended: Type.Optional(Type.String()),
}, { additionalProperties: false });
function result(value, isError = false) {
    return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        details: value,
        isError,
    };
}
function failure(error) {
    return result({ error: error instanceof Error ? error.message : String(error) }, true);
}
function textContent(result) {
    return result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
}
export default function decisions(pi) {
    const pending = new Set();
    const monitors = new Map();
    // Sequential tools keep a question's submit/wait and watcher acquisition indivisible in this runtime.
    const remember = () => pi.appendEntry("pi-decisions.pending", { statePaths: [...pending] });
    async function observe(file, ctx) {
        const previous = monitors.get(file);
        if (previous) {
            const listed = await ctx.executeTool("MonitorList", {});
            if (listed.isError)
                throw new Error("Unable to verify the existing answer watcher; inspect MonitorList");
            const line = textContent(listed.result)
                .split("\n")
                .find((line) => line.includes(`#${previous} [`));
            if (line?.includes("[running]"))
                return previous;
            monitors.delete(file);
            throw new Error("Answer watcher ended without an archived answer. Inspect MonitorList for the failure, then call WaitForAnswer again to re-arm.");
        }
        const state = await loadState(file, ctx.sessionManager.getSessionId());
        const outcome = await ctx.executeTool("MonitorCreate", {
            command: watcherCommand(file),
            description: `Wait for decision ${state.questionId}`,
            timeout: 0,
            onDone: "Decision watcher ended. Call WaitForAnswer with " +
                JSON.stringify({ questionId: state.questionId }) +
                ". The answer is valid only if archived; a watcher failure/cancellation is an error, not a user response. Inspect MonitorList if no answer exists.",
        });
        if (outcome.isError)
            throw new Error(`Unable to start the answer watcher: ${textContent(outcome.result)}`);
        const details = outcome.result.details;
        const id = typeof details?.monitorId === "string"
            ? details.monitorId
            : textContent(outcome.result).match(/Monitor #?(\S+) started:/)?.[1];
        if (!id)
            throw new Error("MonitorCreate did not return an identifiable watcher. Inspect MonitorList before retrying.");
        monitors.set(file, id);
        return id;
    }
    pi.registerTool({
        name: "SubmitQuestion",
        label: "SubmitQuestion",
        description: "Present a fixed single-choice, multiple-choice or free-text review page. Supply questionId, mode (single|multiple|review), question, optional ordered content blocks, and options for choice modes. Blocks are {type:'text',text}, {type:'image',path,alt,caption?}, {type:'video',path,caption?}, or {type:'mermaid',code,caption?}; both the question and each {id,label,content?} option use the same blocks. Media paths must be complete absolute filesystem paths. No task, dir, options file, HTML or CSS is needed. Review mode omits options/recommended. Choice modes need nonempty unique-ID options. Delivery is routed internally using pi-decisions.backend configuration (default local), not a tool argument. Hosted delivery is public; only submit content approved for public sharing. Share the returned URL, then call WaitForAnswer({questionId}) once. Reuse requires identical immutable content and session identity.",
        parameters: submission,
        executionMode: "sequential",
        async execute(_id, params, signal, _update, ctx) {
            try {
                const config = pi.getSettings()["pi-decisions"];
                const backend = config?.backend ?? "local";
                if (backend !== "here.now" && backend !== "local")
                    throw new Error("pi-decisions.backend must be here.now or local");
                const state = await submitQuestion(params, {
                    sessionId: ctx.sessionManager.getSessionId(),
                    cwd: ctx.cwd,
                    backend: backend,
                }, signal);
                pending.add(state.statePath);
                remember();
                return result(submissionResult(state));
            }
            catch (e) {
                return failure(e);
            }
        },
    });
    pi.registerTool({
        name: "WaitForAnswer",
        label: "WaitForAnswer",
        description: "Check a decision in this session immediately. Supply only questionId. If unanswered, arm/reuse one pi-loop-monitor watcher and return waiting; yield rather than repeatedly calling. Watcher archives a validated answer before waking this session. Stopped/reloaded machines do not wake automatically.",
        parameters: Type.Object({ questionId: Type.String() }, { additionalProperties: false }),
        executionMode: "sequential",
        async execute(_id, params, signal, _update, ctx) {
            try {
                const state = await findState(params.questionId, ctx.cwd, ctx.sessionManager.getSessionId());
                const checked = await checkAnswer(state.statePath, signal);
                if (checked.status === "answered") {
                    pending.delete(state.statePath);
                    monitors.delete(state.statePath);
                    remember();
                    return result({ ...checked, responsePath: state.responsePath });
                }
                pending.add(state.statePath);
                remember();
                const monitorId = await observe(state.statePath, ctx);
                return result({
                    status: "waiting",
                    questionId: state.questionId,
                    url: state.url,
                    statePath: state.statePath,
                    responsePath: state.responsePath,
                    monitorId,
                    instruction: "Yield until the watcher completion wake; do not poll with model turns.",
                });
            }
            catch (e) {
                return failure(e);
            }
        },
    });
    pi.on("session_start", async (_event, ctx) => {
        pending.clear();
        monitors.clear();
        for (const entry of ctx.sessionManager.getBranch())
            if (entry.type === "custom" &&
                entry.customType === "pi-decisions.pending") {
                const paths = entry.data?.statePaths;
                if (Array.isArray(paths)) {
                    pending.clear();
                    for (const file of paths)
                        if (typeof file === "string")
                            pending.add(file);
                }
            }
        const rearm = [];
        let unavailable = 0;
        for (const file of [...pending]) {
            try {
                const state = await loadState(file, ctx.sessionManager.getSessionId());
                if (await optionalJson(state.responsePath))
                    rearm.push({
                        questionId: state.questionId,
                        status: "answer archived",
                    });
                else
                    rearm.push({
                        questionId: state.questionId,
                        status: "needs watcher re-arm; local delivery may need identical SubmitQuestion first",
                    });
            }
            catch {
                pending.delete(file);
                unavailable += 1;
            }
        }
        if (unavailable)
            remember();
        if (rearm.length || unavailable)
            pi.sendMessage({
                customType: "pi-decisions.rearm",
                content: "Pending browser decisions were reopened. Classic monitors stop on reload/switch/shutdown. Call WaitForAnswer once for each to consume/re-arm: " +
                    JSON.stringify(rearm) +
                    (unavailable
                        ? ` ${unavailable} saved questions could not be reopened. Resubmit them with fresh question IDs using the direct interface; existing files were left unchanged.`
                        : ""),
                display: true,
            }, { triggerTurn: true, deliverAs: "followUp" });
    });
    pi.on("session_shutdown", async () => {
        // pi-loop-monitor owns stopping its classic monitors; lifecycle context intentionally has no executeTool.
        await stopOwnedChildren();
        pending.clear();
        monitors.clear();
    });
}
