import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LangfuseConfig, LangfuseDiagnostic, LangfuseRunContext } from "./config.js";
import type { TracingRuntime } from "./runtime.js";
export interface SessionRecorderOptions {
    getRuntime: () => TracingRuntime | undefined;
    config: LangfuseConfig;
    context?: LangfuseRunContext;
    diagnostic: (diagnostic: LangfuseDiagnostic) => void;
}
/**
 * One recorder per Pi session. Tracks at most one run at a time, which matches
 * Pi's one-operation-per-session model, and never relies on ambient OTel context.
 */
export declare class SessionRecorder {
    private readonly options;
    private readonly scrub;
    private readonly policy;
    private readonly reported;
    private run;
    private compaction;
    private sessionTraceAttributes;
    constructor(options: SessionRecorderOptions);
    register(pi: ExtensionAPI): void;
    private beginRun;
    private captureContext;
    private noteTurnStart;
    private noteTurnEnd;
    private beginGeneration;
    private noteFirstToken;
    private endGeneration;
    private beginTool;
    private endTool;
    private beginCompaction;
    private endCompaction;
    private failCompaction;
    /** Closes a pending compaction without an agent run (cancel, supersede or shutdown). */
    private closePendingCompaction;
    private sessionTraceAttributesFor;
    private finishRun;
    private finalizeOnShutdown;
    private closeRun;
    private metadata;
    /** Builds final attributes and always ends the span, even on attribute failure. */
    private endSpan;
    private closeGeneration;
    private guard;
    private report;
}
