import type { LangfuseCaptureMode, LangfusePayloadStage, LangfuseRedactor } from "./config.js";
export interface PayloadPolicy {
    mode: LangfuseCaptureMode;
    scrub: (text: string) => string;
    redact?: LangfuseRedactor;
    runId?: string;
}
export interface ProjectedPayload {
    /** Present only when full capture is enabled and the payload survived redaction. */
    value?: unknown;
    /** True when full capture was enabled but the payload was dropped. */
    dropped: boolean;
}
/**
 * Builds the mandatory text scrubber applied before and after the caller
 * redactor. Every nonempty configured credential and Langfuse-shaped key token
 * is removed from any string that can reach a span attribute.
 */
export declare function createScrubber(secrets: readonly string[]): (text: string) => string;
/**
 * Projects one payload under the capture policy. Metadata mode returns no value.
 * Full mode sanitizes media bytes, provider signatures and credentials, runs the
 * optional caller redactor, then sanitizes the redactor's output again so a hook
 * cannot reintroduce sensitive data. Any thrown getter, cycle or redaction
 * failure drops the payload instead of falling back to raw data.
 */
export declare function projectPayload(value: unknown, stage: LangfusePayloadStage, policy: PayloadPolicy): ProjectedPayload;
