/**
 * Package-owned pinned CPU EmbeddingGemma 2 runtime.
 *
 * The operator supplies compatible assets through package settings. Nothing is downloaded, installed,
 * discovered globally, inherited from a provider or borrowed from a foreign listener.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { EmbeddingsError } from './errors.js';
import { requestJson } from './provider-http.js';
import type { EmbeddingsProvider, PreparedInput, ProviderBatchResult } from './provider-types.js';
import { parseBatchResponse } from './response.js';
import {
  EMBEDDING_DOCUMENT_PREFIX,
  EMBEDDING_FORMAT_VERSION,
  EMBEDDING_NORMALIZATION_VERSION,
  type EmbeddingSpace,
} from './schemas.js';

const MODEL_SHA256 = '2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135';
const RUNTIME_COMMIT = 'af6b5243d6871923dfecbe06814bd566d9dc383b';
const DEFAULT_PORT = 8791;

export type LocalRuntimeConfig = Readonly<{
  executable: string;
  modelPath: string;
  port: number;
}>;

const tokenResponseSchema = Type.Object({
  tokens: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1 }),
});

export const LOCAL_EMBEDDING_SPACE: EmbeddingSpace = Object.freeze({
  provider: 'local',
  model: 'embeddinggemma-2',
  revision: `6ea3e3a309d12a4779cfda98b8c19800d2d5da71:sha256:${MODEL_SHA256}`,
  quantization: 'Q8_0',
  runtime: `llama.cpp:${RUNTIME_COMMIT}:mean`,
  dimensions: 768,
  format: EMBEDDING_FORMAT_VERSION,
  prefix: EMBEDDING_DOCUMENT_PREFIX,
  normalization: EMBEDDING_NORMALIZATION_VERSION,
});

class LocalRuntimeProvider implements EmbeddingsProvider {
  readonly route = 'local' as const;
  readonly model = 'embeddinggemma-2';
  readonly space: EmbeddingSpace = LOCAL_EMBEDDING_SPACE;
  readonly maxRequestInputs = Number.POSITIVE_INFINITY;
  readonly maxRequestTokens = Number.POSITIVE_INFINITY;
  readonly #origin: URL;
  readonly #process: ChildProcess;
  readonly #closed: Promise<void>;
  #closeStarted = false;

  private constructor(child: ChildProcess, port: number, closed: Promise<void>) {
    this.#process = child;
    this.#origin = new URL(`http://127.0.0.1:${port}`);
    this.#closed = closed;
  }

  static async open(config: LocalRuntimeConfig, signal: AbortSignal): Promise<LocalRuntimeProvider> {
    const environment = { PATH: process.env.PATH, HOME: process.env.HOME };
    try {
      await access(config.executable, constants.X_OK);
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(config.modelPath, { signal }))
        digest.update(chunk);
      if (digest.digest('hex') !== MODEL_SHA256) throw new EmbeddingsError('local-model-mismatch');
      const version = await promisify(execFile)(config.executable, ['--version'], {
        signal,
        env: environment,
      });
      if (!(version.stdout + version.stderr).includes('af6b5243'))
        throw new EmbeddingsError('local-runtime-mismatch');
    } catch (error) {
      if (error instanceof EmbeddingsError) throw error;
      if (signal.aborted) throw new EmbeddingsError('cancelled');
      throw new EmbeddingsError('local-resources-unavailable');
    }
    signal.throwIfAborted();
    const child = spawn(
      config.executable,
      [
        '--model', config.modelPath,
        '--alias', 'embeddinggemma-2',
        '--offline',
        '--embedding',
        '--pooling', 'mean',
        '--embd-normalize', '2',
        '--ctx-size', '8192',
        '--parallel', '1',
        '--batch-size', '8192',
        '--ubatch-size', '8192',
        '--gpu-layers', '0',
        '--device', 'none',
        '--no-op-offload',
        '--no-kv-offload',
        '--no-cache-prompt',
        '--host', '127.0.0.1',
        '--port', String(config.port),
        '--no-webui',
        '--no-warmup',
        '--log-colors', 'off',
        '--verbosity', '4',
      ],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    const provider = new LocalRuntimeProvider(child, config.port, closed);
    const abort = (): void => {
      child.kill('SIGTERM');
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        let cpuBuffer = false;
        let gpuBuffer = false;
        const observe = (line: string): void => {
          cpuBuffer ||= /CPU[^\n]*model buffer|model buffer[^\n]*CPU/iu.test(line);
          gpuBuffer ||=
            /(Metal|MTL\d|CUDA|Vulkan)[^\n]*(model|compute|KV).*buffer size|offloaded\s+[1-9]\d*\//iu.test(
              line
            );
          if (line.includes('listening on http://127.0.0.1:')) {
            if (cpuBuffer && !gpuBuffer && !signal.aborted) resolve();
            else reject(new EmbeddingsError('local-cpu-startup-invalid'));
          }
        };
        if (child.stdout) createInterface({ input: child.stdout }).on('line', observe);
        if (child.stderr) createInterface({ input: child.stderr }).on('line', observe);
        child.once('error', () => reject(new EmbeddingsError('local-startup-failed')));
        child.once('close', () => reject(new EmbeddingsError('local-startup-failed')));
      });
      const health = await fetch(new URL('/health', provider.#origin), { signal, redirect: 'error' });
      if (!health.ok) throw new EmbeddingsError('local-startup-failed');
      return provider;
    } catch (error) {
      await provider.close();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  async prepare(text: string, signal: AbortSignal): Promise<PreparedInput> {
    const response = await requestJson({
      url: new URL('/tokenize', this.#origin),
      body: { content: EMBEDDING_DOCUMENT_PREFIX + text, add_special: true, parse_special: false },
      signal,
    });
    if (!Value.Check(tokenResponseSchema, response))
      throw new EmbeddingsError('provider-response-invalid');
    if (response.tokens.length > 8192) throw new EmbeddingsError('input-too-long');
    return { kind: 'tokens', tokens: response.tokens };
  }

  async embed(inputs: readonly PreparedInput[], signal: AbortSignal): Promise<ProviderBatchResult> {
    const tokens = inputs.map((input) => {
      if (input.kind !== 'tokens') throw new EmbeddingsError('provider-response-invalid');
      return input.tokens;
    });
    const response = await requestJson({
      url: new URL('/v1/embeddings', this.#origin),
      body: { model: this.model, input: tokens, encoding_format: 'float' },
      signal,
    });
    const prepared = tokens.reduce((sum, item) => sum + item.length, 0);
    return parseBatchResponse({
      response,
      space: this.space,
      expectedPreparedTokens: prepared,
      preparedInputTokens: prepared,
    });
  }

  async close(): Promise<void> {
    if (this.#closeStarted) return;
    this.#closeStarted = true;
    if (this.#process.exitCode === null && this.#process.signalCode === null)
      this.#process.kill('SIGTERM');
    await this.#closed;
  }
}

type Entry = {
  readonly key: string;
  readonly controller: AbortController;
  readonly promise: Promise<EmbeddingsProvider>;
  refs: number;
  closing: Promise<void> | null;
};

const entries = new Map<string, Entry>();

const waitFor = (promise: Promise<EmbeddingsProvider>, signal: AbortSignal): Promise<EmbeddingsProvider> => {
  if (signal.aborted) return Promise.reject(new EmbeddingsError('cancelled'));
  let listener: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    listener = () => reject(new EmbeddingsError('cancelled'));
    signal.addEventListener('abort', listener, { once: true });
  });
  return Promise.race([promise, cancelled]).finally(() => {
    if (listener !== undefined) signal.removeEventListener('abort', listener);
  });
};

export type AcquiredLocalRuntime = Readonly<{
  readonly provider: EmbeddingsProvider;
  readonly release: () => Promise<void>;
}>;

/** One owned child per pinned configuration, shared across all runtimes that resolve it. */
export async function acquireLocalRuntime(
  config: LocalRuntimeConfig,
  signal: AbortSignal
): Promise<AcquiredLocalRuntime> {
  signal.throwIfAborted();
  const normalized: LocalRuntimeConfig = {
    executable: config.executable,
    modelPath: config.modelPath,
    port: config.port || DEFAULT_PORT,
  };
  const key = JSON.stringify(normalized);
  let entry = entries.get(key);
  while (entry !== undefined && entry.closing !== null) {
    await entry.closing;
    entry = entries.get(key);
  }
  if (entry === undefined) {
    const controller = new AbortController();
    const promise = LocalRuntimeProvider.open(normalized, controller.signal).catch(
      (error: unknown) => {
        if (entries.get(key)?.controller === controller) entries.delete(key);
        throw error;
      }
    );
    entry = { key, controller, promise, refs: 0, closing: null };
    entries.set(key, entry);
  }
  const acquired = entry;
  acquired.refs += 1;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    acquired.refs -= 1;
    if (acquired.refs > 0) return;
    if (acquired.closing === null)
      acquired.closing = (async () => {
        acquired.controller.abort();
        const provider = await acquired.promise.catch(() => undefined);
        await provider?.close();
      })().finally(() => {
        if (entries.get(acquired.key) === acquired) entries.delete(acquired.key);
      });
    await acquired.closing;
  };
  try {
    return { provider: await waitFor(acquired.promise, signal), release };
  } catch (error) {
    await release();
    throw error;
  }
}
