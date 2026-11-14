import { LangfuseSpanProcessor } from "@langfuse/otel";
import type { Tracer } from "@opentelemetry/api";
import { AlwaysOnSampler, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { DEFAULT_LANGFUSE_BASE_URL, type LangfuseConfig } from "./config.js";
import { createScrubber } from "./payload.js";
import { PACKAGE_VERSION } from "./version.js";

/**
 * One process-scoped exporter runtime owned by a LangfuseTracing instance.
 * Sessions share it; it is never installed as the global OTel provider.
 */
export interface TracingRuntime {
  readonly tracer: Tracer;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

export function startTracingRuntime(config: LangfuseConfig): TracingRuntime {
  const scrub = createScrubber([config.publicKey, config.secretKey]);
  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    // Always explicit: the SDK's nullish fallbacks must never read ambient config.
    baseUrl: config.baseUrl ?? DEFAULT_LANGFUSE_BASE_URL,
    // Empty labels intentionally block ambient fallback; labels are scrubbed too.
    environment: scrub(config.environment ?? ""),
    release: scrub(config.release ?? ""),
    mediaUploadEnabled: false,
  });
  const provider = new BasicTracerProvider({
    spanProcessors: [processor],
    // A private provider for this extension: configured tracing is not silently
    // disabled by an ambient OTEL_TRACES_SAMPLER value.
    sampler: new AlwaysOnSampler(),
  });
  let disposal: Promise<void> | undefined;

  return {
    tracer: provider.getTracer("pi-langfuse", PACKAGE_VERSION),
    flush: () => processor.forceFlush(),
    dispose: () => {
      disposal ??= provider.shutdown();
      return disposal;
    },
  };
}
