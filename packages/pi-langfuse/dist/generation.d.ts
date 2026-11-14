import { type PiUsage } from "./attributes.js";
import type { LangfuseConfig, LangfuseDiagnostic, LangfuseRunContext } from "./config.js";
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
export declare function beginGeneration(options: {
    config: LangfuseConfig | undefined;
    getRuntime: () => TracingRuntime | undefined;
    context: LangfuseRunContext | undefined;
    input: LangfuseGenerationInput;
    diagnostic: (diagnostic: LangfuseDiagnostic) => void;
}): LangfuseGeneration;
