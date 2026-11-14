/**
 * Supported payload stages. Every stage that can carry content or error text
 * passes through the same sanitize + redact boundary.
 */
export type LangfusePayloadStage = "root_input" | "generation_input" | "generation_output" | "tool_input" | "tool_output" | "compaction_output" | "error";
/**
 * Optional caller redaction. It runs after built-in sanitization (media bytes,
 * provider signatures and configured Langfuse credentials are already removed).
 * Throwing or returning `undefined` drops the payload; the raw value is never
 * used as a fallback.
 */
export type LangfuseRedactor = (value: unknown, details: {
    stage: LangfusePayloadStage;
    runId?: string;
}) => unknown;
/** Capture policy. `metadata` sends no prompt, output, thinking or tool bodies. */
export type LangfuseCaptureMode = "metadata" | "full";
/** Supported Langfuse cloud default used when no explicit base URL is set. */
export declare const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
/** Server-owned Langfuse configuration. Never serialized or logged. */
export interface LangfuseConfig {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
    environment?: string;
    release?: string;
    capture?: LangfuseCaptureMode;
    redact?: LangfuseRedactor;
}
/**
 * Optional per-run trace context. This is public trace metadata: callers must
 * not put prompts, tool bodies or secrets in it.
 */
export interface LangfuseRunContext {
    sessionId?: string;
    userId?: string;
    traceName?: string;
    tags?: readonly string[];
    metadata?: Record<string, string | number | boolean>;
}
/** Safe diagnostic codes; messages are fixed strings without keys or paths. */
export type LangfuseDiagnosticCode = "config" | "runtime" | "flush" | "handler";
export interface LangfuseDiagnostic {
    code: LangfuseDiagnosticCode;
    message: string;
}
/**
 * Resolves server-owned configuration from the process environment.
 *
 * Enabled once both keys are configured. `LANGFUSE_ENABLED=false` (or 0/no/off)
 * wins over keys. Missing keys make the extension inert. Unknown capture values
 * fall back to the metadata-only default.
 */
export declare function resolveLangfuseConfig(env?: Record<string, string | undefined>): LangfuseConfig | undefined;
/**
 * Makes every exporter-relevant field concrete so the Langfuse SDK never falls
 * back to ambient environment values. Empty labels intentionally block the SDK's
 * `??` fallbacks for environment and release.
 */
export declare function normalizeLangfuseConfig(config: LangfuseConfig): LangfuseConfig;
