import type { Tracer } from "@opentelemetry/api";
import { type LangfuseConfig } from "./config.js";
/**
 * One process-scoped exporter runtime owned by a LangfuseTracing instance.
 * Sessions share it; it is never installed as the global OTel provider.
 */
export interface TracingRuntime {
    readonly tracer: Tracer;
    flush(): Promise<void>;
    dispose(): Promise<void>;
}
export declare function startTracingRuntime(config: LangfuseConfig): TracingRuntime;
