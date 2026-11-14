import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import type { Attributes } from "@opentelemetry/api";
import type { LangfuseRunContext } from "./config.js";

/** Usage shape exposed by Pi assistant messages. */
export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface ResolvedRunContext {
  traceName: string;
  sessionId?: string;
  userId?: string;
  tags: string[];
  metadata: Record<string, string | number | boolean>;
}

/** Merges the package default and per-session context, with per-session values winning. */
export function resolveRunContext(
  base: LangfuseRunContext | undefined,
  fallbackSessionId: string | undefined,
): ResolvedRunContext {
  const sessionId = base?.sessionId ?? fallbackSessionId;
  const resolved: ResolvedRunContext = {
    traceName: base?.traceName?.trim() || "pi.agent",
    tags: base?.tags ? [...base.tags] : [],
    metadata: base?.metadata ? { ...base.metadata } : {},
  };
  if (sessionId) resolved.sessionId = sessionId;
  const userId = base?.userId?.trim();
  if (userId) resolved.userId = userId;
  return resolved;
}

/**
 * Trace-level attributes copied to every span in the trace so Langfuse can
 * filter and aggregate by them.
 */
export function buildTraceAttributes(
  context: ResolvedRunContext,
  scrub: (text: string) => string,
): Attributes {
  const attributes: Attributes = {
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
    if (serialized === undefined) continue;
    attributes[`${LangfuseOtelSpanAttributes.TRACE_METADATA}.${scrub(key)}`] = scrub(serialized);
  }
  return attributes;
}

/** Langfuse usage buckets. Reasoning is a subset of output and stays metadata. */
export function toUsageDetails(usage: PiUsage): Record<string, number> {
  return {
    input: usage.input,
    output: usage.output,
    cache_read_input_tokens: usage.cacheRead,
    cache_creation_input_tokens: usage.cacheWrite,
    total: usage.totalTokens,
  };
}

export function toCostDetails(usage: PiUsage): Record<string, number> {
  return {
    input: usage.cost.input,
    output: usage.cost.output,
    cache_read_input_tokens: usage.cost.cacheRead,
    cache_creation_input_tokens: usage.cost.cacheWrite,
    total: usage.cost.total,
  };
}

/** Zero-usage aborted/error messages are unmeasured, not free. */
export function hasMeasuredUsage(usage: PiUsage): boolean {
  return (
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.totalTokens > 0
  );
}

/** Removes undefined entries while keeping false, 0 and empty strings. */
export function definedValues(
  values: Record<string, unknown>,
  scrub?: (text: string) => string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    result[key] = typeof value === "string" && scrub ? scrub(value) : value;
  }
  return result;
}

function serializeMetadata(value: string | number | boolean): string | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : serialized;
  } catch {
    return undefined;
  }
}
