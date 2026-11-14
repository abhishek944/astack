import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
/** Merges the package default and per-session context, with per-session values winning. */
export function resolveRunContext(base, fallbackSessionId) {
    const sessionId = base?.sessionId ?? fallbackSessionId;
    const resolved = {
        traceName: base?.traceName?.trim() || "pi.agent",
        tags: base?.tags ? [...base.tags] : [],
        metadata: base?.metadata ? { ...base.metadata } : {},
    };
    if (sessionId)
        resolved.sessionId = sessionId;
    const userId = base?.userId?.trim();
    if (userId)
        resolved.userId = userId;
    return resolved;
}
/**
 * Trace-level attributes copied to every span in the trace so Langfuse can
 * filter and aggregate by them.
 */
export function buildTraceAttributes(context, scrub) {
    const attributes = {
        [LangfuseOtelSpanAttributes.TRACE_NAME]: scrub(context.traceName),
    };
    if (context.sessionId) {
        const sessionId = scrub(context.sessionId);
        attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID] = sessionId;
        attributes[LangfuseOtelSpanAttributes.TRACE_COMPAT_SESSION_ID] = sessionId;
    }
    if (context.userId) {
        const userId = scrub(context.userId);
        attributes[LangfuseOtelSpanAttributes.TRACE_USER_ID] = userId;
        attributes[LangfuseOtelSpanAttributes.TRACE_COMPAT_USER_ID] = userId;
    }
    if (context.tags.length > 0) {
        attributes[LangfuseOtelSpanAttributes.TRACE_TAGS] = context.tags.map(scrub);
    }
    for (const [key, value] of Object.entries(context.metadata)) {
        const serialized = serializeMetadata(value);
        if (serialized === undefined)
            continue;
        attributes[`${LangfuseOtelSpanAttributes.TRACE_METADATA}.${scrub(key)}`] = scrub(serialized);
    }
    return attributes;
}
/** Langfuse usage buckets. Reasoning is a subset of output and stays metadata. */
export function toUsageDetails(usage) {
    return {
        input: usage.input,
        output: usage.output,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
        total: usage.totalTokens,
    };
}
export function toCostDetails(usage) {
    return {
        input: usage.cost.input,
        output: usage.cost.output,
        cache_read_input_tokens: usage.cost.cacheRead,
        cache_creation_input_tokens: usage.cost.cacheWrite,
        total: usage.cost.total,
    };
}
/** Zero-usage aborted/error messages are unmeasured, not free. */
export function hasMeasuredUsage(usage) {
    return (usage.input > 0 ||
        usage.output > 0 ||
        usage.cacheRead > 0 ||
        usage.cacheWrite > 0 ||
        usage.totalTokens > 0);
}
/** Removes undefined entries while keeping false, 0 and empty strings. */
export function definedValues(values, scrub) {
    const result = {};
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined)
            continue;
        result[key] = typeof value === "string" && scrub ? scrub(value) : value;
    }
    return result;
}
function serializeMetadata(value) {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? undefined : serialized;
    }
    catch {
        return undefined;
    }
}
