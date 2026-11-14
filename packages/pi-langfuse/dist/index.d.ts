import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { LangfuseCaptureMode, LangfuseConfig, LangfuseDiagnostic, LangfuseDiagnosticCode, LangfusePayloadStage, LangfuseRedactor, LangfuseRunContext } from "./config.js";
import { resolveLangfuseConfig } from "./config.js";
import { type LangfuseGeneration, type LangfuseGenerationInput } from "./generation.js";
export type { LangfuseGeneration, LangfuseGenerationInput, LangfuseGenerationResult } from "./generation.js";
export type { LangfuseCaptureMode, LangfuseConfig, LangfuseDiagnostic, LangfuseDiagnosticCode, LangfusePayloadStage, LangfuseRedactor, LangfuseRunContext, };
export { resolveLangfuseConfig };
export interface LangfuseTracingOptions {
    /** Explicit inert switch. `false` registers nothing and never reads the environment. */
    enabled?: boolean;
    /** Explicit server config. When supplied, ambient environment keys are never read. */
    config?: LangfuseConfig;
    /** Default trace context for every session created from this instance. */
    context?: LangfuseRunContext;
    /** Safe diagnostic sink. Defaults to one fixed line on stderr. */
    onDiagnostic?: (diagnostic: LangfuseDiagnostic) => void;
}
export interface LangfuseTracing {
    /** True when a usable config was resolved. Runtime creation is lazy. */
    readonly enabled: boolean;
    /**
     * Creates one extension factory for one Pi session. The same tracing instance
     * (and its exporter) can be shared by many concurrent sessions.
     */
    extension(context?: LangfuseRunContext): ExtensionFactory;
    /** Metadata-only standalone Pi-AI call; never use alongside native session observation. */
    generation(input: LangfuseGenerationInput, context?: LangfuseRunContext): LangfuseGeneration;
    /** Flushes pending spans using the SDK's own lifecycle. Caller owns awaiting. */
    flush(): Promise<void>;
    /** Idempotently flushes and shuts down the shared provider. */
    dispose(): Promise<void>;
}
/**
 * Creates a tracing runtime and extension factory for SDK hosts.
 *
 * Without options this resolves server environment configuration once and is
 * inert when keys are absent or disabled. Supplying `config` never falls back to
 * ambient environment keys; `enabled: false` is explicitly inert.
 */
export declare function createLangfuseTracing(options?: LangfuseTracingOptions): LangfuseTracing;
/**
 * Standard Pi package extension. Resolves server environment configuration once;
 * it registers no handlers at all when disabled or unconfigured.
 */
export default function langfuseExtension(pi: ExtensionAPI): void;
