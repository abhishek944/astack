import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
  SessionCompactFailedEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { createObservationAttributes } from "@langfuse/tracing";
import { type Attributes, ROOT_CONTEXT, type Span, trace } from "@opentelemetry/api";
import {
  buildTraceAttributes,
  definedValues,
  hasMeasuredUsage,
  resolveRunContext,
  toCostDetails,
  toUsageDetails,
} from "./attributes.js";
import type { LangfuseConfig, LangfuseDiagnostic, LangfuseRunContext } from "./config.js";
import { createScrubber, type PayloadPolicy, projectPayload } from "./payload.js";
import type { TracingRuntime } from "./runtime.js";

type RunOutcome = "completed" | "aborted" | "error";

interface PendingInput {
  count: number;
  value?: unknown;
  dropped: boolean;
}

interface GenerationState {
  span: Span;
  startMs: number;
  ttft: boolean;
}

interface CompactionState {
  span: Span;
}

interface RunState {
  runtime: TracingRuntime;
  root: Span;
  traceAttributes: Attributes;
  runId?: string;
  startedAt: number;
  turns: number;
  turnIndex?: number;
  generations: number;
  generationErrors: number;
  tools: number;
  toolErrors: number;
  outcome?: RunOutcome;
  pendingInput?: PendingInput;
  generation?: GenerationState;
  toolSpans: Map<string, Span>;
  lastOutput?: unknown;
}

interface RunClose {
  outcome: RunOutcome;
  statusMessage?: string;
  flush: boolean;
}

export interface SessionRecorderOptions {
  getRuntime: () => TracingRuntime | undefined;
  config: LangfuseConfig;
  context?: LangfuseRunContext;
  diagnostic: (diagnostic: LangfuseDiagnostic) => void;
}

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
  private readonly scrub: (text: string) => string;
  private readonly policy: PayloadPolicy;
  private readonly reported = new Set<string>();
  private run: RunState | undefined;
  private compaction: CompactionState | undefined;
  private sessionTraceAttributes: Attributes | undefined;

  constructor(private readonly options: SessionRecorderOptions) {
    this.scrub = createScrubber([options.config.publicKey, options.config.secretKey]);
    this.policy = {
      mode: options.config.capture === "full" ? "full" : "metadata",
      scrub: this.scrub,
      redact: options.config.redact,
    };
  }

  register(pi: ExtensionAPI): void {
    pi.on(
      "before_agent_start",
      this.guard((event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
        this.beginRun(event, ctx);
      }),
    );
    pi.on(
      "context",
      this.guard((event: { messages: readonly unknown[] }) => {
        this.captureContext(event.messages);
      }),
    );
    pi.on(
      "turn_start",
      this.guard((event: TurnStartEvent) => {
        this.noteTurnStart(event);
      }),
    );
    pi.on(
      "message_start",
      this.guard((event: MessageStartEvent) => {
        this.beginGeneration(event);
      }),
    );
    pi.on(
      "message_update",
      this.guard((event: MessageUpdateEvent) => {
        this.noteFirstToken(event);
      }),
    );
    pi.on(
      "message_end",
      this.guard((event: MessageEndEvent) => {
        this.endGeneration(event);
      }),
    );
    pi.on(
      "tool_execution_start",
      this.guard((event: ToolExecutionStartEvent) => {
        this.beginTool(event);
      }),
    );
    pi.on(
      "tool_execution_end",
      this.guard((event: ToolExecutionEndEvent) => {
        this.endTool(event);
      }),
    );
    pi.on(
      "turn_end",
      this.guard((event: TurnEndEvent) => {
        this.noteTurnEnd(event);
      }),
    );
    pi.on(
      "session_before_compact",
      this.guard((event: SessionBeforeCompactEvent, ctx: ExtensionContext) => {
        this.beginCompaction(event, ctx);
      }),
    );
    pi.on(
      "session_compact",
      this.guard((event: SessionCompactEvent) => {
        this.endCompaction(event);
      }),
    );
    pi.on(
      "session_compact_failed",
      this.guard((event: SessionCompactFailedEvent) => {
        this.failCompaction(event);
      }),
    );
    pi.on(
      "agent_settled",
      this.guard((event: AgentSettledEvent) => {
        this.finishRun(event);
      }),
    );
    pi.on(
      "session_shutdown",
      this.guard(() => {
        this.finalizeOnShutdown();
      }),
    );
  }

  private beginRun(event: BeforeAgentStartEvent, ctx: ExtensionContext): void {
    const runtime = this.options.getRuntime();
    if (!runtime) return;
    if (this.run) {
      this.closeRun({ outcome: "aborted", statusMessage: "agent superseded", flush: false });
    }

    const traceContext = resolveRunContext(this.options.context, readSessionId(ctx));
    const runId =
      typeof traceContext.metadata.runId === "string" ? traceContext.metadata.runId : undefined;
    const traceAttributes = buildTraceAttributes(traceContext, this.scrub);
    const input = projectPayload(rootInput(event), "root_input", { ...this.policy, runId });
    const attributes: Attributes = {
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
    const root = runtime.tracer.startSpan(
      "pi.agent",
      { startTime: new Date(), attributes },
      ROOT_CONTEXT,
    );

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

  private captureContext(messages: readonly unknown[]): void {
    const run = this.run;
    if (!run) return;
    const input = projectPayload(messages, "generation_input", {
      ...this.policy,
      runId: run.runId,
    });
    run.pendingInput = { count: messages.length, value: input.value, dropped: input.dropped };
  }

  private noteTurnStart(event: TurnStartEvent): void {
    const run = this.run;
    if (!run) return;
    run.turns += 1;
    run.turnIndex = event.turnIndex;
  }

  private noteTurnEnd(event: TurnEndEvent): void {
    const run = this.run;
    if (!run) return;
    run.outcome = event.outcome;
    run.turnIndex = event.turnIndex;
  }

  private beginGeneration(event: MessageStartEvent): void {
    const run = this.run;
    if (!run || event.message.role !== "assistant") return;
    this.closeGeneration(run, "generation superseded");

    const message = event.message;
    const startMs = Number.isFinite(message.timestamp) ? message.timestamp : Date.now();
    const pending = run.pendingInput;
    run.pendingInput = undefined;
    const model = this.scrub(message.model || "generation");
    const attributes: Attributes = {
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
    const span = run.runtime.tracer.startSpan(
      model,
      { startTime: new Date(startMs), attributes },
      trace.setSpanContext(ROOT_CONTEXT, run.root.spanContext()),
    );
    run.generation = { span, startMs, ttft: false };
  }

  private noteFirstToken(event: MessageUpdateEvent): void {
    const run = this.run;
    const generation = run?.generation;
    if (!run || !generation || generation.ttft) return;
    if (!FIRST_TOKEN_EVENTS.has(event.assistantMessageEvent.type)) return;
    generation.ttft = true;
    generation.span.setAttributes(
      createObservationAttributes("generation", {
        completionStartTime: new Date(),
        metadata: { ttftMs: Math.max(0, Date.now() - generation.startMs) },
      }),
    );
  }

  private endGeneration(event: MessageEndEvent): void {
    const run = this.run;
    const generation = run?.generation;
    if (!run || !generation || event.message.role !== "assistant") return;
    run.generation = undefined;

    const message = event.message;
    const output = projectPayload(message.content, "generation_output", {
      ...this.policy,
      runId: run.runId,
    });
    const usage = message.usage;
    const measured = hasMeasuredUsage(usage);
    const level =
      message.stopReason === "error" ? "ERROR" : message.stopReason === "aborted" ? "WARNING" : undefined;
    const statusMessage =
      message.stopReason === "error"
        ? "generation error"
        : message.stopReason === "aborted"
          ? "generation aborted"
          : undefined;

    this.endSpan(generation.span, () =>
      createObservationAttributes("generation", {
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
      }),
    );

    run.generations += 1;
    if (message.stopReason === "error") run.generationErrors += 1;
    if (this.policy.mode === "full" && output.value !== undefined) run.lastOutput = output.value;
  }

  private beginTool(event: ToolExecutionStartEvent): void {
    const run = this.run;
    if (!run) return;
    const parent = event.parentToolCallId ? run.toolSpans.get(event.parentToolCallId) : undefined;
    const input = projectPayload(event.args, "tool_input", { ...this.policy, runId: run.runId });
    const attributes: Attributes = {
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
    const span = run.runtime.tracer.startSpan(
      this.scrub(event.toolName),
      { startTime: new Date(), attributes },
      trace.setSpanContext(ROOT_CONTEXT, (parent ?? run.root).spanContext()),
    );
    run.toolSpans.set(event.toolCallId, span);
  }

  private endTool(event: ToolExecutionEndEvent): void {
    const run = this.run;
    if (!run) return;
    const span = run.toolSpans.get(event.toolCallId);
    if (!span) return;
    run.toolSpans.delete(event.toolCallId);

    const output = projectPayload(event.result, "tool_output", { ...this.policy, runId: run.runId });
    this.endSpan(span, () =>
      createObservationAttributes("tool", {
        ...(output.value === undefined ? {} : { output: output.value }),
        ...(event.isError ? { level: "ERROR", statusMessage: "tool error" } : {}),
        metadata: this.metadata({
          durationMs: event.durationMs,
          isError: event.isError,
          outputDropped: output.dropped ? true : undefined,
        }),
      }),
    );

    run.tools += 1;
    if (event.isError) run.toolErrors += 1;
  }

  private beginCompaction(event: SessionBeforeCompactEvent, ctx: ExtensionContext): void {
    const run = this.run;
    const runtime = run?.runtime ?? this.options.getRuntime();
    if (!runtime) return;

    this.closePendingCompaction("compaction superseded");
    const traceAttributes = run?.traceAttributes ?? this.sessionTraceAttributesFor(ctx);
    const parentContext = run
      ? trace.setSpanContext(ROOT_CONTEXT, run.root.spanContext())
      : ROOT_CONTEXT;
    const span = runtime.tracer.startSpan(
      "compaction",
      {
        startTime: new Date(),
        attributes: {
          ...traceAttributes,
          ...createObservationAttributes("span", {
            metadata: this.metadata({ reason: event.reason, willRetry: event.willRetry }),
          }),
        },
      },
      parentContext,
    );
    this.compaction = { span };
  }

  private endCompaction(event: SessionCompactEvent): void {
    const pending = this.compaction;
    if (!pending) return;
    this.compaction = undefined;

    const output = projectPayload(event.compactionEntry.summary, "compaction_output", {
      ...this.policy,
      runId: this.run?.runId,
    });
    const usage = event.compactionEntry.usage;
    const measured = usage !== undefined && hasMeasuredUsage(usage);
    this.endSpan(pending.span, () =>
      createObservationAttributes("span", {
        ...(output.value === undefined ? {} : { output: output.value }),
        ...(measured && usage ? { usageDetails: toUsageDetails(usage), costDetails: toCostDetails(usage) } : {}),
        metadata: this.metadata({
          reason: event.reason,
          willRetry: event.willRetry,
          fromExtension: event.fromExtension,
          tokensBefore: event.compactionEntry.tokensBefore,
          summaryDropped: output.dropped ? true : undefined,
        }),
      }),
    );
  }

  private failCompaction(event: SessionCompactFailedEvent): void {
    const pending = this.compaction;
    if (!pending) return;
    this.compaction = undefined;
    this.endSpan(pending.span, () =>
      createObservationAttributes("span", {
        level: event.aborted ? "WARNING" : "ERROR",
        statusMessage: event.aborted ? "compaction aborted" : "compaction failed",
        metadata: this.metadata({
          reason: event.reason,
          aborted: event.aborted,
          fromExtension: event.fromExtension,
          willRetry: event.willRetry,
        }),
      }),
    );
  }

  /** Closes a pending compaction without an agent run (cancel, supersede or shutdown). */
  private closePendingCompaction(statusMessage: string): void {
    const pending = this.compaction;
    if (!pending) return;
    this.compaction = undefined;
    this.endSpan(pending.span, () =>
      createObservationAttributes("span", { level: "WARNING", statusMessage }),
    );
  }

  private sessionTraceAttributesFor(ctx: ExtensionContext): Attributes {
    if (!this.sessionTraceAttributes) {
      const traceContext = resolveRunContext(this.options.context, readSessionId(ctx));
      this.sessionTraceAttributes = buildTraceAttributes(traceContext, this.scrub);
    }
    return this.sessionTraceAttributes;
  }

  private finishRun(event: AgentSettledEvent): void {
    const run = this.run;
    if (!run) return;
    const outcome: RunOutcome = event.aborted ? "aborted" : (run.outcome ?? "completed");
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

  private finalizeOnShutdown(): void {
    this.closePendingCompaction("compaction incomplete");
    if (!this.run) return;
    this.closeRun({ outcome: "aborted", statusMessage: "agent aborted", flush: true });
  }

  private closeRun(status: RunClose): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;

    this.closeGeneration(run, "generation incomplete");
    for (const span of run.toolSpans.values()) {
      this.endSpan(span, () =>
        createObservationAttributes("tool", {
          level: "WARNING",
          statusMessage: "tool incomplete",
        }),
      );
    }
    run.toolSpans.clear();

    const level =
      status.outcome === "error" ? "ERROR" : status.outcome === "aborted" ? "WARNING" : undefined;
    this.endSpan(run.root, () =>
      createObservationAttributes("agent", {
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
      }),
    );

    if (status.flush) {
      void run.runtime.flush().catch(() => this.report("flush", "flush failed"));
    }
  }

  private metadata(values: Record<string, unknown>): Record<string, unknown> {
    return definedValues(values, this.scrub);
  }

  /** Builds final attributes and always ends the span, even on attribute failure. */
  private endSpan(span: Span, buildAttributes: () => Attributes): void {
    try {
      span.setAttributes(buildAttributes());
    } catch {
      this.report("handler", "tracing handler failed");
    } finally {
      span.end();
    }
  }

  private closeGeneration(run: RunState, statusMessage: string): void {
    const generation = run.generation;
    if (!generation) return;
    run.generation = undefined;
    this.endSpan(generation.span, () =>
      createObservationAttributes("generation", {
        level: "WARNING",
        statusMessage,
      }),
    );
  }

  private guard<Args extends unknown[]>(handler: (...args: Args) => void): (...args: Args) => void {
    return (...args) => {
      try {
        handler(...args);
      } catch {
        this.report("handler", "tracing handler failed");
      }
    };
  }

  private report(code: LangfuseDiagnostic["code"], message: string): void {
    if (this.reported.has(code)) return;
    this.reported.add(code);
    this.options.diagnostic({ code, message });
  }
}

function readSessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return undefined;
  }
}

/** Builds root input for both user-started and custom-message-started runs. */
function rootInput(event: BeforeAgentStartEvent): Record<string, unknown> {
  const input: Record<string, unknown> = { systemPrompt: event.systemPrompt };
  if ("prompt" in event) input.prompt = event.prompt;
  if ("images" in event) input.images = event.images;
  if ("message" in event) input.message = event.message;
  return input;
}
