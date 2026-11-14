import { normalizeLangfuseConfig, resolveLangfuseConfig } from "./config.js";
import { beginGeneration } from "./generation.js";
import { SessionRecorder } from "./recorder.js";
import { startTracingRuntime } from "./runtime.js";
export { resolveLangfuseConfig };
/**
 * Creates a tracing runtime and extension factory for SDK hosts.
 *
 * Without options this resolves server environment configuration once and is
 * inert when keys are absent or disabled. Supplying `config` never falls back to
 * ambient environment keys; `enabled: false` is explicitly inert.
 */
export function createLangfuseTracing(options = {}) {
    const diagnostic = safeDiagnostic(options.onDiagnostic ?? writeDiagnostic);
    const resolvedConfig = options.enabled === false ? undefined : (options.config ?? resolveLangfuseConfig());
    const config = resolvedConfig ? normalizeLangfuseConfig(resolvedConfig) : undefined;
    const baseContext = options.context;
    let runtime;
    let runtimeFailed = false;
    let closed = false;
    let disposal;
    const getRuntime = () => {
        if (!config || closed)
            return undefined;
        if (runtime)
            return runtime;
        if (runtimeFailed)
            return undefined;
        try {
            runtime = startTracingRuntime(config);
            return runtime;
        }
        catch {
            runtimeFailed = true;
            diagnostic({ code: "runtime", message: "tracing runtime could not start" });
            return undefined;
        }
    };
    return {
        enabled: config !== undefined,
        extension(sessionContext) {
            const runContext = mergeRunContext(baseContext, sessionContext);
            return (pi) => {
                if (!config || closed)
                    return;
                const recorder = new SessionRecorder({
                    getRuntime,
                    config,
                    ...(runContext ? { context: runContext } : {}),
                    diagnostic,
                });
                recorder.register(pi);
            };
        },
        generation(input, context) {
            return beginGeneration({ config: closed ? undefined : config, getRuntime,
                context: mergeRunContext(baseContext, context), input, diagnostic });
        },
        flush() {
            if (disposal)
                return disposal;
            return runtime ? runtime.flush() : Promise.resolve();
        },
        dispose() {
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
export default function langfuseExtension(pi) {
    const tracing = createLangfuseTracing();
    if (!tracing.enabled)
        return;
    tracing.extension()(pi);
    pi.on("session_shutdown", () => {
        void tracing.dispose().catch(() => undefined);
    });
}
function mergeRunContext(base, override) {
    if (!base)
        return override;
    if (!override)
        return base;
    return {
        ...base,
        ...override,
        tags: override.tags ?? base.tags,
        metadata: { ...base.metadata, ...override.metadata },
    };
}
function safeDiagnostic(sink) {
    return (diagnostic) => {
        try {
            absorbThenable(sink(diagnostic));
        }
        catch {
            // A failing diagnostic sink must never break tracing or the agent.
        }
    };
}
/** Attaches a rejection handler without awaiting; a void-typed sink may still be async. */
function absorbThenable(value) {
    if (!isThenable(value))
        return;
    try {
        void Promise.resolve(value).catch(() => undefined);
    }
    catch {
        // Thenable access or rejection handling must never escape.
    }
}
function isThenable(value) {
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
        return false;
    return typeof Reflect.get(value, "then") === "function";
}
function writeDiagnostic(diagnostic) {
    try {
        process.stderr.write(`[pi-langfuse] ${diagnostic.code}: ${diagnostic.message}\n`);
    }
    catch {
        // Diagnostics must never break the agent.
    }
}
