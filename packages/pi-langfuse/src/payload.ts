import type { LangfuseCaptureMode, LangfusePayloadStage, LangfuseRedactor } from "./config.js";

const REDACTED = "[redacted]";
const OMITTED_MEDIA = "[omitted-media]";
const CIRCULAR = "[circular]";
const UNSUPPORTED = "[unsupported]";
const SIGNATURE_KEYS = new Set(["textSignature", "thinkingSignature", "thoughtSignature"]);

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
export function createScrubber(secrets: readonly string[]): (text: string) => string {
  const values = secrets
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);
  return (text) => {
    let result = text;
    for (const secret of values) {
      if (result.includes(secret)) result = result.split(secret).join(REDACTED);
    }
    return result.replace(/\b(?:pk|sk)-(?:lf-)?[A-Za-z0-9][A-Za-z0-9._-]{7,}\b/g, REDACTED);
  };
}

/**
 * Projects one payload under the capture policy. Metadata mode returns no value.
 * Full mode sanitizes media bytes, provider signatures and credentials, runs the
 * optional caller redactor, then sanitizes the redactor's output again so a hook
 * cannot reintroduce sensitive data. Any thrown getter, cycle or redaction
 * failure drops the payload instead of falling back to raw data.
 */
export function projectPayload(
  value: unknown,
  stage: LangfusePayloadStage,
  policy: PayloadPolicy,
): ProjectedPayload {
  if (policy.mode !== "full" || value === undefined) return { dropped: false };

  try {
    const sanitized = sanitizeValue(value, policy.scrub, new WeakSet<object>());
    let candidate = sanitized;
    if (policy.redact) {
      candidate = policy.redact(sanitized, { stage, runId: policy.runId });
    }
    if (candidate === undefined) return { dropped: true };
    if (isThenable(candidate)) {
      absorbThenable(candidate);
      return { dropped: true };
    }
    return { value: sanitizeValue(candidate, policy.scrub, new WeakSet<object>()), dropped: false };
  } catch {
    return { dropped: true };
  }
}

function sanitizeValue(
  value: unknown,
  scrub: (text: string) => string,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === "string") return scrub(value);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return UNSUPPORTED;
  if (isThenable(value)) {
    absorbThenable(value);
    return UNSUPPORTED;
  }
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) return CIRCULAR;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeValue(entry, scrub, ancestors));
    }
    if (!isRecord(value)) return UNSUPPORTED;
    if (isMediaPart(value)) return { type: "image", value: OMITTED_MEDIA };

    const projected: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SIGNATURE_KEYS.has(key)) continue;
      projected[scrub(key)] = sanitizeValue(child, scrub, ancestors);
    }
    return projected;
  } finally {
    ancestors.delete(value);
  }
}

function isMediaPart(value: Record<string, unknown>): boolean {
  return (
    value.type === "image" &&
    (typeof value.data === "string" ||
      typeof value.mimeType === "string" ||
      value.source !== undefined)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof Reflect.get(value, "then") === "function";
}

/** Async diagnostics/redactors are unsupported; absorb their rejection without awaiting. */
function absorbThenable(value: PromiseLike<unknown>): void {
  try {
    void Promise.resolve(value).catch(() => undefined);
  } catch {
    // A hostile thenable must never escape the payload or diagnostic boundary.
  }
}
