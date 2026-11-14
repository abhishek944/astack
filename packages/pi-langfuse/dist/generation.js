import { createObservationAttributes } from "@langfuse/tracing";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import { buildTraceAttributes, definedValues, hasMeasuredUsage, resolveRunContext, toCostDetails, toUsageDetails, } from "./attributes.js";
import { createScrubber } from "./payload.js";
/** Standalone Pi-AI calls only. Never attach this to an already observed AgentSession. */
export function beginGeneration(options) {
    let span;
    let runtime;
    let ended = false;
    const report = () => options.diagnostic({ code: "handler", message: "generation tracing failed" });
    try {
        if (options.config) {
            runtime = options.getRuntime();
            if (runtime) {
                const scrub = createScrubber([options.config.publicKey, options.config.secretKey]);
                span = runtime.tracer.startSpan("pi.generation", {
                    attributes: {
                        ...buildTraceAttributes(resolveRunContext(options.context, undefined), scrub),
                        ...createObservationAttributes("generation", {
                            model: scrub(options.input.model),
                            metadata: { provider: scrub(options.input.provider) },
                        }),
                    },
                }, ROOT_CONTEXT);
            }
        }
    }
    catch {
        report();
    }
    return {
        end(result) {
            if (ended)
                return;
            ended = true;
            if (!span)
                return;
            try {
                const usage = result.usage;
                const measured = usage !== undefined && hasMeasuredUsage(usage);
                span.setAttributes(createObservationAttributes("generation", {
                    ...(measured && usage ? { usageDetails: toUsageDetails(usage), costDetails: toCostDetails(usage) } : {}),
                    ...(result.outcome === "error" ? { level: "ERROR", statusMessage: "generation error" }
                        : result.outcome !== "completed" ? { level: "WARNING", statusMessage: "generation incomplete" } : {}),
                    metadata: definedValues({ outcome: result.outcome, durationMs: result.durationMs }),
                }));
            }
            catch {
                report();
            }
            finally {
                try {
                    span.end();
                }
                catch {
                    report();
                }
                try {
                    void runtime?.flush().catch(() => options.diagnostic({ code: "flush", message: "flush failed" }));
                }
                catch {
                    report();
                }
            }
        },
    };
}
