import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
  LangfuseCaptureMode,
  LangfuseConfig,
  LangfuseDiagnostic,
  LangfuseDiagnosticCode,
  LangfusePayloadStage,
  LangfuseRedactor,
  LangfuseRunContext,
} from "./config.js";
import { normalizeLangfuseConfig, resolveLangfuseConfig } from "./config.js";
import { beginGeneration, type LangfuseGeneration, type LangfuseGenerationInput } from "./generation.js";
import { SessionRecorder } from "./recorder.js";
import { startTracingRuntime, type TracingRuntime } from "./runtime.js";

export type { LangfuseGeneration, LangfuseGenerationInput, LangfuseGenerationResult } from "./generation.js";
export type {
  LangfuseCaptureMode,
  LangfuseConfig,
  LangfuseDiagnostic,
  LangfuseDiagnosticCode,
  LangfusePayloadStage,
  LangfuseRedactor,
  LangfuseRunContext,
};
export { resolveLangfuseConfig };

export interface LangfuseTracingOptions {
  /** Explicit inert switch. `false` registers nothing and never reads the environment. */
  enabled?: boolean;
  /** Explicit server config. When supplied, ambient environment keys are never read. */
  config?: LangfuseConfig;
  /** Default trace context for every session created from this instance. */
  context?: LangfuseRunContext;
  /** Safe diagnostic sink. Defaults to one fixed line on stderr. */
  onDiagnostic?: (diagnostic: LangfuseDiagnostic) => void;
}

export interface LangfuseTracing {
  /** True when a usable config was resolved. Runtime creation is lazy. */
  readonly enabled: boolean;
  /**
   * Creates one extension factory for one Pi session. The same tracing instance
   * (and its exporter) can be shared by many concurrent sessions.
   */
  extension(context?: LangfuseRunContext): ExtensionFactory;
  /** Metadata-only standalone Pi-AI call; never use alongside native session observation. */
  generation(input: LangfuseGenerationInput, context?: LangfuseRunContext): LangfuseGeneration;
  /** Flushes pending spans using the SDK's own lifecycle. Caller owns awaiting. */
  flush(): Promise<void>;
  /** Idempotently flushes and shuts down the shared provider. */
  dispose(): Promise<void>;
}

/**
 * Creates a tracing runtime and extension factory for SDK hosts.
 *
 * Without options this resolves server environment configuration once and is
 * inert when keys are absent or disabled. Supplying `config` never falls back to
 * ambient environment keys; `enabled: false` is explicitly inert.
 */
export function createLangfuseTracing(options: LangfuseTracingOptions = {}): LangfuseTracing {
  const diagnostic = safeDiagnostic(options.onDiagnostic ?? writeDiagnostic);
  const resolvedConfig =
    options.enabled === false ? undefined : (options.config ?? resolveLangfuseConfig());
  const config = resolvedConfig ? normalizeLangfuseConfig(resolvedConfig) : undefined;
  const baseContext = options.context;
  let runtime: TracingRuntime | undefined;
  let runtimeFailed = false;
  let closed = false;
  let disposal: Promise<void> | undefined;

  const getRuntime = (): TracingRuntime | undefined => {
    if (!config || closed) return undefined;
    if (runtime) return runtime;
    if (runtimeFailed) return undefined;
    try {
      runtime = startTracingRuntime(config);
      return runtime;
    } catch {
      runtimeFailed = true;
      diagnostic({ code: "runtime", message: "tracing runtime could not start" });
      return undefined;
    }
  };

  return {
    enabled: config !== undefined,
    extension(sessionContext?: LangfuseRunContext): ExtensionFactory {
      const runContext = mergeRunContext(baseContext, sessionContext);
      return (pi: ExtensionAPI): void => {
        if (!config || closed) return;
        const recorder = new SessionRecorder({
          getRuntime,
          config,
          ...(runContext ? { context: runContext } : {}),
          diagnostic,
        });
        recorder.register(pi);
      };
    },
    generation(input, context): LangfuseGeneration {
      return beginGeneration({ config: closed ? undefined : config, getRuntime,
        context: mergeRunContext(baseContext, context), input, diagnostic });
    },
    flush(): Promise<void> {
      if (disposal) return disposal;
      return runtime ? runtime.flush() : Promise.resolve();
    },
    dispose(): Promise<void> {
      closed = true;
      if (!disposal) {
        const active = runtime;
        runtime = undefined;
        disposal = active ? active.dispose() : Promise.resolve();
      }
      return disposal;
    },
  };
}

/**
 * Standard Pi package extension. Resolves server environment configuration once;
 * it registers no handlers at all when disabled or unconfigured.
 */
export default function langfuseExtension(pi: ExtensionAPI): void {
  const tracing = createLangfuseTracing();
  if (!tracing.enabled) return;
  tracing.extension()(pi);
  pi.on("session_shutdown", () => {
    void tracing.dispose().catch(() => undefined);
  });
}

function mergeRunContext(
  base: LangfuseRunContext | undefined,
  override: LangfuseRunContext | undefined,
): LangfuseRunContext | undefined {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...override,
    tags: override.tags ?? base.tags,
    metadata: { ...base.metadata, ...override.metadata },
  };
}

function safeDiagnostic(
  sink: (diagnostic: LangfuseDiagnostic) => void,
): (diagnostic: LangfuseDiagnostic) => void {
  return (diagnostic) => {
    try {
      absorbThenable(sink(diagnostic));
    } catch {
      // A failing diagnostic sink must never break tracing or the agent.
    }
  };
}

/** Attaches a rejection handler without awaiting; a void-typed sink may still be async. */
function absorbThenable(value: unknown): void {
  if (!isThenable(value)) return;
  try {
    void Promise.resolve(value).catch(() => undefined);
  } catch {
    // Thenable access or rejection handling must never escape.
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof Reflect.get(value, "then") === "function";
}

function writeDiagnostic(diagnostic: LangfuseDiagnostic): void {
  try {
    process.stderr.write(`[pi-langfuse] ${diagnostic.code}: ${diagnostic.message}\n`);
  } catch {
    // Diagnostics must never break the agent.
  }
}
