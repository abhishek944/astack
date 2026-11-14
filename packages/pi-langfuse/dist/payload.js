const REDACTED = "[redacted]";
const OMITTED_MEDIA = "[omitted-media]";
const CIRCULAR = "[circular]";
const UNSUPPORTED = "[unsupported]";
const SIGNATURE_KEYS = new Set(["textSignature", "thinkingSignature", "thoughtSignature"]);
/**
 * Builds the mandatory text scrubber applied before and after the caller
 * redactor. Every nonempty configured credential and Langfuse-shaped key token
 * is removed from any string that can reach a span attribute.
 */
export function createScrubber(secrets) {
    const values = secrets
        .filter((secret) => secret.length > 0)
        .sort((left, right) => right.length - left.length);
    return (text) => {
        let result = text;
        for (const secret of values) {
            if (result.includes(secret))
                result = result.split(secret).join(REDACTED);
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
export function projectPayload(value, stage, policy) {
    if (policy.mode !== "full" || value === undefined)
        return { dropped: false };
    try {
        const sanitized = sanitizeValue(value, policy.scrub, new WeakSet());
        let candidate = sanitized;
        if (policy.redact) {
            candidate = policy.redact(sanitized, { stage, runId: policy.runId });
        }
        if (candidate === undefined)
            return { dropped: true };
        if (isThenable(candidate)) {
            absorbThenable(candidate);
            return { dropped: true };
        }
        return { value: sanitizeValue(candidate, policy.scrub, new WeakSet()), dropped: false };
    }
    catch {
        return { dropped: true };
    }
}
function sanitizeValue(value, scrub, ancestors) {
    if (typeof value === "string")
        return scrub(value);
    if (value === null || typeof value === "boolean" || typeof value === "number")
        return value;
    if (typeof value === "bigint")
        return UNSUPPORTED;
    if (isThenable(value)) {
        absorbThenable(value);
        return UNSUPPORTED;
    }
    if (typeof value !== "object")
        return undefined;
    if (ancestors.has(value))
        return CIRCULAR;
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((entry) => sanitizeValue(entry, scrub, ancestors));
        }
        if (!isRecord(value))
            return UNSUPPORTED;
        if (isMediaPart(value))
            return { type: "image", value: OMITTED_MEDIA };
        const projected = {};
        for (const [key, child] of Object.entries(value)) {
            if (SIGNATURE_KEYS.has(key))
                continue;
            projected[scrub(key)] = sanitizeValue(child, scrub, ancestors);
        }
        return projected;
    }
    finally {
        ancestors.delete(value);
    }
}
function isMediaPart(value) {
    return (value.type === "image" &&
        (typeof value.data === "string" ||
            typeof value.mimeType === "string" ||
            value.source !== undefined));
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isThenable(value) {
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
        return false;
    return typeof Reflect.get(value, "then") === "function";
}
/** Async diagnostics/redactors are unsupported; absorb their rejection without awaiting. */
function absorbThenable(value) {
    try {
        void Promise.resolve(value).catch(() => undefined);
    }
    catch {
        // A hostile thenable must never escape the payload or diagnostic boundary.
    }
}
