import { createObservationAttributes } from "@langfuse/tracing";
import { ROOT_CONTEXT, type Span } from "@opentelemetry/api";
import {
  buildTraceAttributes, definedValues, hasMeasuredUsage, type PiUsage, resolveRunContext,
  toCostDetails, toUsageDetails,
} from "./attributes.js";
import type { LangfuseConfig, LangfuseDiagnostic, LangfuseRunContext } from "./config.js";
import { createScrubber } from "./payload.js";
import type { TracingRuntime } from "./runtime.js";

/** Only measured Pi metadata is accepted; no input/output/error payload seam. */
export interface LangfuseGenerationResult {
  outcome: "completed" | "error" | "aborted" | "incomplete";
  usage?: PiUsage;
  durationMs?: number;
}
export interface LangfuseGeneration {
  /** Idempotent, fail-open, synchronous finalization; exporter delivery is nonblocking. */
  end(result: LangfuseGenerationResult): void;
}
export interface LangfuseGenerationInput {
  model: string;
  provider: string;
}

/** Standalone Pi-AI calls only. Never attach this to an already observed AgentSession. */
export function beginGeneration(options: {
  config: LangfuseConfig | undefined;
  getRuntime: () => TracingRuntime | undefined;
  context: LangfuseRunContext | undefined;
  input: LangfuseGenerationInput;
  diagnostic: (diagnostic: LangfuseDiagnostic) => void;
}): LangfuseGeneration {
  let span: Span | undefined;
  let runtime: TracingRuntime | undefined;
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
  } catch { report(); }
  return {
    end(result): void {
      if (ended) return;
      ended = true;
      if (!span) return;
      try {
        const usage = result.usage;
        const measured = usage !== undefined && hasMeasuredUsage(usage);
        span.setAttributes(createObservationAttributes("generation", {
          ...(measured && usage ? { usageDetails: toUsageDetails(usage), costDetails: toCostDetails(usage) } : {}),
          ...(result.outcome === "error" ? { level: "ERROR", statusMessage: "generation error" }
            : result.outcome !== "completed" ? { level: "WARNING", statusMessage: "generation incomplete" } : {}),
          metadata: definedValues({ outcome: result.outcome, durationMs: result.durationMs }),
        }));
      } catch { report(); }
      finally {
        try { span.end(); } catch { report(); }
        try { void runtime?.flush().catch(() => options.diagnostic({ code: "flush", message: "flush failed" })); }
        catch { report(); }
      }
    },
  };
}
