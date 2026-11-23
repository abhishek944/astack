import { acquireProvider, routeDiagnostics, routeKey, spaceForRoute, type AcquiredProvider } from './providers.js';
import { configuredDefault, configuredRoutes, validateEmbeddingSettings } from './settings.js';
import { executeCompare, executeEmbeddings } from './execute.js';
import { EmbeddingsError } from './errors.js';
import {
  EMBEDDINGS_PROTOCOL_VERSION,
  type EmbeddingCompareResult,
  type EmbeddingContext,
  type EmbeddingDescribe,
  type EmbeddingRequest,
  type EmbeddingResult,
  type EmbeddingRoute,
  type EmbeddingSettings,
} from './schemas.js';

export interface EmbeddingsRuntime {
  /** Acquire the selected local child at MCP startup; cloud selections start no local process. */
  start(): Promise<void>;
  embed(
    request: EmbeddingRequest,
    options?: { signal?: AbortSignal | undefined; context?: EmbeddingContext | undefined }
  ): Promise<EmbeddingResult>;
  compare(
    request: EmbeddingRequest,
    options?: { signal?: AbortSignal | undefined; context?: EmbeddingContext | undefined }
  ): Promise<EmbeddingCompareResult>;
  describe(): EmbeddingDescribe;
  close(): Promise<void>;
}

const noSignal = (signal: AbortSignal | undefined): AbortSignal => signal ?? new AbortController().signal;

export function createEmbeddingsRuntime(args: {
  settings: EmbeddingSettings;
  cwd?: string | undefined;
}): EmbeddingsRuntime {
  const settings = validateEmbeddingSettings(args.settings);
  const defaultRoute = configuredDefault(settings);
  const fallbackRoutes = configuredRoutes(settings, 'fallback');
  const compareRoutes = configuredRoutes(settings, 'compare');
  const acquired = new Map<string, AcquiredProvider>();
  const pending = new Map<string, Promise<AcquiredProvider>>();
  const lateReleases: Promise<void>[] = [];
  const lifetime = new AbortController();
  let closed = false;
  let closing: Promise<void> | undefined;

  /**
   * Acquisitions belong to the runtime, not to one call. A caller's cancellation only stops waiting;
   * it never releases a shared local child that another call may be using.
   */
  const acquireShared = (route: EmbeddingRoute): Promise<AcquiredProvider> => {
    const key = routeKey(route);
    const cached = acquired.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const inFlight = pending.get(key);
    if (inFlight !== undefined) return inFlight;
    const promise = acquireProvider({ settings, route, signal: lifetime.signal })
      .then((entry) => {
        pending.delete(key);
        if (closed || closing !== undefined) {
          lateReleases.push(entry.release());
          throw new Error('The embeddings runtime is closed.');
        }
        acquired.set(key, entry);
        return entry;
      })
      .catch((error: unknown) => {
        pending.delete(key);
        throw error;
      });
    pending.set(key, promise);
    return promise;
  };

  const acquire = (route: EmbeddingRoute, signal: AbortSignal): Promise<AcquiredProvider> => {
    if (closed || closing !== undefined) return Promise.reject(new Error('The embeddings runtime is closed.'));
    if (signal.aborted) return Promise.reject(new EmbeddingsError('cancelled'));
    let listener: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      listener = () => reject(new EmbeddingsError('cancelled'));
      signal.addEventListener('abort', listener, { once: true });
    });
    return Promise.race([acquireShared(route), cancelled]).finally(() => {
      if (listener !== undefined) signal.removeEventListener('abort', listener);
    });
  };

  return {
    async start(): Promise<void> {
      if (defaultRoute.provider === 'local') await acquire(defaultRoute, lifetime.signal);
    },
    async embed(request, options) {
      return executeEmbeddings({
        routes: [defaultRoute, ...fallbackRoutes],
        request,
        context: options?.context,
        signal: noSignal(options?.signal),
        allowFallback: true,
        acquire,
      });
    },
    async compare(request, options) {
      return executeCompare({
        routes: compareRoutes,
        request,
        context: options?.context,
        signal: noSignal(options?.signal),
        acquire,
      });
    },
    describe() {
      const defaultDiagnostics = routeDiagnostics(settings, defaultRoute);
      const diagnostics = [...defaultDiagnostics];
      for (const route of fallbackRoutes)
        diagnostics.push(...routeDiagnostics(settings, route).map((entry) => ({
          ...entry,
          severity: 'warning' as const,
        })));
      return {
        schemaVersion: EMBEDDINGS_PROTOCOL_VERSION,
        ready: defaultDiagnostics.length === 0,
        selected: defaultRoute,
        space: spaceForRoute(defaultRoute),
        default: defaultRoute,
        fallback: [...fallbackRoutes],
        compare: [...compareRoutes],
        diagnostics,
      };
    },
    close() {
      closing ??= (async () => {
        closed = true;
        lifetime.abort();
        const inFlight = [...pending.values()];
        const entries = [...acquired.values()];
        acquired.clear();
        await Promise.allSettled(inFlight);
        await Promise.allSettled(lateReleases);
        for (const entry of entries) await entry.release();
        pending.clear();
      })();
      return closing;
    },
  };
}
