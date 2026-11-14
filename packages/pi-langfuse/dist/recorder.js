import { createObservationAttributes } from "@langfuse/tracing";
import { ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { buildTraceAttributes, definedValues, hasMeasuredUsage, resolveRunContext, toCostDetails, toUsageDetails, } from "./attributes.js";
import { createScrubber, projectPayload } from "./payload.js";
const FIRST_TOKEN_EVENTS = new Set([
    "text_start",
    "text_delta",
    "thinking_start",
    "thinking_delta",
    "toolcall_start",
    "toolcall_delta",
]);
/**
 * One recorder per Pi session. Tracks at most one run at a time, which matches
 * Pi's one-operation-per-session model, and never relies on ambient OTel context.
 */
export class SessionRecorder {
    options;
    scrub;
    policy;
    reported = new Set();
    run;
    compaction;
    sessionTraceAttributes;
    constructor(options) {
        this.options = options;
        this.scrub = createScrubber([options.config.publicKey, options.config.secretKey]);
        this.policy = {
            mode: options.config.capture === "full" ? "full" : "metadata",
            scrub: this.scrub,
            redact: options.config.redact,
        };
    }
    register(pi) {
        pi.on("before_agent_start", this.guard((event, ctx) => {
            this.beginRun(event, ctx);
        }));
        pi.on("context", this.guard((event) => {
            this.captureContext(event.messages);
        }));
        pi.on("turn_start", this.guard((event) => {
            this.noteTurnStart(event);
        }));
        pi.on("message_start", this.guard((event) => {
            this.beginGeneration(event);
        }));
        pi.on("message_update", this.guard((event) => {
            this.noteFirstToken(event);
        }));
        pi.on("message_end", this.guard((event) => {
            this.endGeneration(event);
        }));
        pi.on("tool_execution_start", this.guard((event) => {
            this.beginTool(event);
        }));
        pi.on("tool_execution_end", this.guard((event) => {
            this.endTool(event);
        }));
        pi.on("turn_end", this.guard((event) => {
            this.noteTurnEnd(event);
        }));
        pi.on("session_before_compact", this.guard((event, ctx) => {
            this.beginCompaction(event, ctx);
        }));
        pi.on("session_compact", this.guard((event) => {
            this.endCompaction(event);
        }));
        pi.on("session_compact_failed", this.guard((event) => {
            this.failCompaction(event);
        }));
        pi.on("agent_settled", this.guard((event) => {
            this.finishRun(event);
        }));
        pi.on("session_shutdown", this.guard(() => {
            this.finalizeOnShutdown();
        }));
    }
    beginRun(event, ctx) {
        const runtime = this.options.getRuntime();
        if (!runtime)
            return;
        if (this.run) {
            this.closeRun({ outcome: "aborted", statusMessage: "agent superseded", flush: false });
        }
        const traceContext = resolveRunContext(this.options.context, readSessionId(ctx));
        const runId = typeof traceContext.metadata.runId === "string" ? traceContext.metadata.runId : undefined;
        const traceAttributes = buildTraceAttributes(traceContext, this.scrub);
        const input = projectPayload(rootInput(event), "root_input", { ...this.policy, runId });
        const attributes = {
            ...traceAttributes,
            ...createObservationAttributes("agent", {
                ...(input.value === undefined ? {} : { input: input.value }),
                metadata: this.metadata({
                    model: ctx.model?.id,
                    provider: ctx.model?.provider,
                    api: ctx.model?.api,
                    thinkingLevel: ctx.thinkingLevel,
                    inputDropped: input.dropped ? true : undefined,
                }),
            }),
        };
        const root = runtime.tracer.startSpan("pi.agent", { startTime: new Date(), attributes }, ROOT_CONTEXT);
        this.run = {
            runtime,
            root,
            traceAttributes,
            ...(runId ? { runId } : {}),
            startedAt: Date.now(),
            turns: 0,
            generations: 0,
            generationErrors: 0,
            tools: 0,
            toolErrors: 0,
            toolSpans: new Map(),
        };
    }
    captureContext(messages) {
        const run = this.run;
        if (!run)
            return;
        const input = projectPayload(messages, "generation_input", {
            ...this.policy,
            runId: run.runId,
        });
        run.pendingInput = { count: messages.length, value: input.value, dropped: input.dropped };
    }
    noteTurnStart(event) {
        const run = this.run;
        if (!run)
            return;
        run.turns += 1;
        run.turnIndex = event.turnIndex;
    }
    noteTurnEnd(event) {
        const run = this.run;
        if (!run)
            return;
        run.outcome = event.outcome;
        run.turnIndex = event.turnIndex;
    }
    beginGeneration(event) {
        const run = this.run;
        if (!run || event.message.role !== "assistant")
            return;
        this.closeGeneration(run, "generation superseded");
        const message = event.message;
        const startMs = Number.isFinite(message.timestamp) ? message.timestamp : Date.now();
        const pending = run.pendingInput;
        run.pendingInput = undefined;
        const model = this.scrub(message.model || "generation");
        const attributes = {
            ...run.traceAttributes,
            ...createObservationAttributes("generation", {
                model,
                ...(pending?.value === undefined ? {} : { input: pending.value }),
                metadata: this.metadata({
                    provider: message.provider,
                    api: message.api,
                    turnIndex: run.turnIndex,
                    inputMessages: pending?.count,
                    inputDropped: pending?.dropped ? true : undefined,
                    thinkingLevel: message.thinkingLevel,
                }),
            }),
        };
        const span = run.runtime.tracer.startSpan(model, { startTime: new Date(startMs), attributes }, trace.setSpanContext(ROOT_CONTEXT, run.root.spanContext()));
        run.generation = { span, startMs, ttft: false };
    }
    noteFirstToken(event) {
        const run = this.run;
        const generation = run?.generation;
        if (!run || !generation || generation.ttft)
            return;
        if (!FIRST_TOKEN_EVENTS.has(event.assistantMessageEvent.type))
            return;
        generation.ttft = true;
        generation.span.setAttributes(createObservationAttributes("generation", {
            completionStartTime: new Date(),
            metadata: { ttftMs: Math.max(0, Date.now() - generation.startMs) },
        }));
    }
    endGeneration(event) {
        const run = this.run;
        const generation = run?.generation;
        if (!run || !generation || event.message.role !== "assistant")
            return;
        run.generation = undefined;
        const message = event.message;
        const output = projectPayload(message.content, "generation_output", {
            ...this.policy,
            runId: run.runId,
        });
        const usage = message.usage;
        const measured = hasMeasuredUsage(usage);
        const level = message.stopReason === "error" ? "ERROR" : message.stopReason === "aborted" ? "WARNING" : undefined;
        const statusMessage = message.stopReason === "error"
            ? "generation error"
            : message.stopReason === "aborted"
                ? "generation aborted"
                : undefined;
        this.endSpan(generation.span, () => createObservationAttributes("generation", {
            model: this.scrub(message.model || "generation"),
            ...(output.value === undefined ? {} : { output: output.value }),
            ...(measured ? { usageDetails: toUsageDetails(usage), costDetails: toCostDetails(usage) } : {}),
            ...(level ? { level } : {}),
            ...(statusMessage ? { statusMessage } : {}),
            metadata: this.metadata({
                stopReason: message.stopReason,
                responseModel: message.responseModel,
                responseId: message.responseId,
                durationMs: message.durationMs,
                reasoningTokens: usage.reasoning,
                cacheWrite1hTokens: usage.cacheWrite1h,
                outputDropped: output.dropped ? true : undefined,
            }),
        }));
        run.generations += 1;
        if (message.stopReason === "error")
            run.generationErrors += 1;
        if (this.policy.mode === "full" && output.value !== undefined)
            run.lastOutput = output.value;
    }
    beginTool(event) {
        const run = this.run;
        if (!run)
            return;
        const parent = event.parentToolCallId ? run.toolSpans.get(event.parentToolCallId) : undefined;
        const input = projectPayload(event.args, "tool_input", { ...this.policy, runId: run.runId });
        const attributes = {
            ...run.traceAttributes,
            ...createObservationAttributes("tool", {
                ...(input.value === undefined ? {} : { input: input.value }),
                metadata: this.metadata({
                    toolCallId: event.toolCallId,
                    parentToolCallId: event.parentToolCallId,
                    turnIndex: run.turnIndex,
                    inputDropped: input.dropped ? true : undefined,
                }),
            }),
        };
        const span = run.runtime.tracer.startSpan(this.scrub(event.toolName), { startTime: new Date(), attributes }, trace.setSpanContext(ROOT_CONTEXT, (parent ?? run.root).spanContext()));
        run.toolSpans.set(event.toolCallId, span);
    }
    endTool(event) {
        const run = this.run;
        if (!run)
            return;
        const span = run.toolSpans.get(event.toolCallId);
        if (!span)
            return;
        run.toolSpans.delete(event.toolCallId);
        const output = projectPayload(event.result, "tool_output", { ...this.policy, runId: run.runId });
        this.endSpan(span, () => createObservationAttributes("tool", {
            ...(output.value === undefined ? {} : { output: output.value }),
            ...(event.isError ? { level: "ERROR", statusMessage: "tool error" } : {}),
            metadata: this.metadata({
                durationMs: event.durationMs,
                isError: event.isError,
                outputDropped: output.dropped ? true : undefined,
            }),
        }));
        run.tools += 1;
        if (event.isError)
            run.toolErrors += 1;
    }
    beginCompaction(event, ctx) {
        const run = this.run;
        const runtime = run?.runtime ?? this.options.getRuntime();
        if (!runtime)
            return;
        this.closePendingCompaction("compaction superseded");
        const traceAttributes = run?.traceAttributes ?? this.sessionTraceAttributesFor(ctx);
        const parentContext = run
            ? trace.setSpanContext(ROOT_CONTEXT, run.root.spanContext())
            : ROOT_CONTEXT;
        const span = runtime.tracer.startSpan("compaction", {
            startTime: new Date(),
            attributes: {
                ...traceAttributes,
                ...createObservationAttributes("span", {
                    metadata: this.metadata({ reason: event.reason, willRetry: event.willRetry }),
                }),
            },
        }, parentContext);
        this.compaction = { span };
    }
    endCompaction(event) {
        const pending = this.compaction;
        if (!pending)
            return;
        this.compaction = undefined;
        const output = projectPayload(event.compactionEntry.summary, "compaction_output", {
            ...this.policy,
            runId: this.run?.runId,
        });
        const usage = event.compactionEntry.usage;
        const measured = usage !== undefined && hasMeasuredUsage(usage);
        this.endSpan(pending.span, () => createObservationAttributes("span", {
            ...(output.value === undefined ? {} : { output: output.value }),
            ...(measured && usage ? { usageDetails: toUsageDetails(usage), costDetails: toCostDetails(usage) } : {}),
            metadata: this.metadata({
                reason: event.reason,
                willRetry: event.willRetry,
                fromExtension: event.fromExtension,
                tokensBefore: event.compactionEntry.tokensBefore,
                summaryDropped: output.dropped ? true : undefined,
            }),
        }));
    }
    failCompaction(event) {
        const pending = this.compaction;
        if (!pending)
            return;
        this.compaction = undefined;
        this.endSpan(pending.span, () => createObservationAttributes("span", {
            level: event.aborted ? "WARNING" : "ERROR",
            statusMessage: event.aborted ? "compaction aborted" : "compaction failed",
            metadata: this.metadata({
                reason: event.reason,
                aborted: event.aborted,
                fromExtension: event.fromExtension,
                willRetry: event.willRetry,
            }),
        }));
    }
    /** Closes a pending compaction without an agent run (cancel, supersede or shutdown). */
    closePendingCompaction(statusMessage) {
        const pending = this.compaction;
        if (!pending)
            return;
        this.compaction = undefined;
        this.endSpan(pending.span, () => createObservationAttributes("span", { level: "WARNING", statusMessage }));
    }
    sessionTraceAttributesFor(ctx) {
        if (!this.sessionTraceAttributes) {
            const traceContext = resolveRunContext(this.options.context, readSessionId(ctx));
            this.sessionTraceAttributes = buildTraceAttributes(traceContext, this.scrub);
        }
        return this.sessionTraceAttributes;
    }
    finishRun(event) {
        const run = this.run;
        if (!run)
            return;
        const outcome = event.aborted ? "aborted" : (run.outcome ?? "completed");
        this.closeRun({
            outcome,
            ...(outcome === "error"
                ? { statusMessage: "agent error" }
                : outcome === "aborted"
                    ? { statusMessage: "agent aborted" }
                    : {}),
            flush: true,
        });
    }
    finalizeOnShutdown() {
        this.closePendingCompaction("compaction incomplete");
        if (!this.run)
            return;
        this.closeRun({ outcome: "aborted", statusMessage: "agent aborted", flush: true });
    }
    closeRun(status) {
        const run = this.run;
        if (!run)
            return;
        this.run = undefined;
        this.closeGeneration(run, "generation incomplete");
        for (const span of run.toolSpans.values()) {
            this.endSpan(span, () => createObservationAttributes("tool", {
                level: "WARNING",
                statusMessage: "tool incomplete",
            }));
        }
        run.toolSpans.clear();
        const level = status.outcome === "error" ? "ERROR" : status.outcome === "aborted" ? "WARNING" : undefined;
        this.endSpan(run.root, () => createObservationAttributes("agent", {
            ...(status.outcome === "completed" &&
                this.policy.mode === "full" &&
                run.lastOutput !== undefined
                ? { output: run.lastOutput }
                : {}),
            ...(level ? { level } : {}),
            ...(status.statusMessage ? { statusMessage: status.statusMessage } : {}),
            metadata: this.metadata({
                outcome: status.outcome,
                turns: run.turns,
                generations: run.generations,
                generationErrors: run.generationErrors,
                tools: run.tools,
                toolErrors: run.toolErrors,
                durationMs: Math.max(0, Date.now() - run.startedAt),
            }),
        }));
        if (status.flush) {
            void run.runtime.flush().catch(() => this.report("flush", "flush failed"));
        }
    }
    metadata(values) {
        return definedValues(values, this.scrub);
    }
    /** Builds final attributes and always ends the span, even on attribute failure. */
    endSpan(span, buildAttributes) {
        try {
            span.setAttributes(buildAttributes());
        }
        catch {
            this.report("handler", "tracing handler failed");
        }
        finally {
            span.end();
        }
    }
    closeGeneration(run, statusMessage) {
        const generation = run.generation;
        if (!generation)
            return;
        run.generation = undefined;
        this.endSpan(generation.span, () => createObservationAttributes("generation", {
            level: "WARNING",
            statusMessage,
        }));
    }
    guard(handler) {
        return (...args) => {
            try {
                handler(...args);
            }
            catch {
                this.report("handler", "tracing handler failed");
            }
        };
    }
    report(code, message) {
        if (this.reported.has(code))
            return;
        this.reported.add(code);
        this.options.diagnostic({ code, message });
    }
}
function readSessionId(ctx) {
    try {
        return ctx.sessionManager.getSessionId();
    }
    catch {
        return undefined;
    }
}
/** Builds root input for both user-started and custom-message-started runs. */
function rootInput(event) {
    const input = { systemPrompt: event.systemPrompt };
    if ("prompt" in event)
        input.prompt = event.prompt;
    if ("images" in event)
        input.images = event.images;
    if ("message" in event)
        input.message = event.message;
    return input;
}
