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
export declare function resolveRunContext(base: LangfuseRunContext | undefined, fallbackSessionId: string | undefined): ResolvedRunContext;
/**
 * Trace-level attributes copied to every span in the trace so Langfuse can
 * filter and aggregate by them.
 */
export declare function buildTraceAttributes(context: ResolvedRunContext, scrub: (text: string) => string): Attributes;
/** Langfuse usage buckets. Reasoning is a subset of output and stays metadata. */
export declare function toUsageDetails(usage: PiUsage): Record<string, number>;
export declare function toCostDetails(usage: PiUsage): Record<string, number>;
/** Zero-usage aborted/error messages are unmeasured, not free. */
export declare function hasMeasuredUsage(usage: PiUsage): boolean;
/** Removes undefined entries while keeping false, 0 and empty strings. */
export declare function definedValues(values: Record<string, unknown>, scrub?: (text: string) => string): Record<string, unknown>;
