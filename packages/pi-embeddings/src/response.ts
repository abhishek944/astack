import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { EmbeddingsError } from './errors.js';
import type { ProviderBatchResult } from './provider-types.js';
import type { EmbeddingSpace } from './schemas.js';

const responseSchema = Type.Object({
  model: Type.Optional(Type.String({ minLength: 1 })),
  data: Type.Array(
    Type.Object({
      index: Type.Integer({ minimum: 0 }),
      embedding: Type.Array(Type.Number()),
    })
  ),
  usage: Type.Object({
    prompt_tokens: Type.Integer({ minimum: 0 }),
  }),
});

const cloudflareResponseSchema = Type.Object({
  shape: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
  data: Type.Array(Type.Array(Type.Number())),
  pooling: Type.Optional(Type.Union([Type.Literal('mean'), Type.Literal('cls')])),
});

/** Cloudflare REST wraps model output in a standard API envelope; bindings return the raw model output. */
function unwrapCloudflareModelOutput(response: unknown): unknown {
  if (typeof response !== 'object' || response === null || Array.isArray(response))
    throw new EmbeddingsError('provider-response-invalid', { knownUsage: {} });
  const envelope = response as Record<string, unknown>;
  if (
    envelope.success === false ||
    (Array.isArray(envelope.errors) && envelope.errors.length > 0)
  )
    throw new EmbeddingsError('provider-response-invalid', { knownUsage: {} });
  return Object.hasOwn(envelope, 'result') ? envelope.result : envelope;
}

/** Stable, overflow-safe L2 normalization. The identity is recorded in every success outcome. */
export function normalizeVector(vector: readonly number[], dimensions: number): number[] {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))
    throw new EmbeddingsError('vector-invalid');
  const scale = vector.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  if (scale === 0) throw new EmbeddingsError('vector-zero');
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value / scale) ** 2, 0));
  return vector.map((value) => value / scale / norm);
}

export function parseBatchResponse(args: {
  response: unknown;
  space: EmbeddingSpace;
  expectedModels?: readonly string[];
  expectedPreparedTokens?: number | null;
  preparedInputTokens?: number | null;
}): ProviderBatchResult {
  const prepared = args.preparedInputTokens ?? args.expectedPreparedTokens ?? null;
  if (!Value.Check(responseSchema, args.response))
    throw new EmbeddingsError('provider-response-invalid', {
      knownUsage: { preparedInputTokens: prepared },
    });
  const parsed = args.response;
  const known = (code: 'provider-response-mismatch' | 'vector-invalid' | 'vector-zero'): EmbeddingsError =>
    new EmbeddingsError(code, {
      knownUsage: {
        providerReportedInputTokens: parsed.usage.prompt_tokens,
        preparedInputTokens: prepared,
      },
    });
  const admitted = args.expectedModels ?? [args.space.model];
  if (admitted.length > 0 && (parsed.model === undefined || !admitted.includes(parsed.model)))
    throw known('provider-response-mismatch');
  if (prepared !== null && parsed.usage.prompt_tokens !== prepared)
    throw known('provider-response-mismatch');
  const ordered = [...parsed.data].sort((left, right) => left.index - right.index);
  if (ordered.some((item, index) => item.index !== index))
    throw known('provider-response-mismatch');
  let vectors: number[][];
  try {
    vectors = ordered.map((item) => normalizeVector(item.embedding, args.space.dimensions));
  } catch (error) {
    if (error instanceof EmbeddingsError)
      throw known(error.code === 'vector-zero' ? 'vector-zero' : 'vector-invalid');
    throw error;
  }
  return {
    vectors,
    usage: {
      providerReportedInputTokens: parsed.usage.prompt_tokens,
      preparedInputTokens: prepared,
      billedTokens: null,
    },
  };
}

/** Cloudflare Workers AI `/ai/run` wraps ordered vectors without usage in the REST API envelope. */
export function parseCloudflareBatchResponse(args: {
  response: unknown;
  space: EmbeddingSpace;
  expectedCount: number;
}): ProviderBatchResult {
  const output = unwrapCloudflareModelOutput(args.response);
  if (!Value.Check(cloudflareResponseSchema, output))
    throw new EmbeddingsError('provider-response-invalid', { knownUsage: {} });
  const parsed = output;
  if (parsed.data.length !== args.expectedCount)
    throw new EmbeddingsError('provider-response-mismatch', { knownUsage: {} });
  let vectors: number[][];
  try {
    vectors = parsed.data.map((vector) => normalizeVector(vector, args.space.dimensions));
  } catch (error) {
    if (error instanceof EmbeddingsError)
      throw new EmbeddingsError(error.code === 'vector-zero' ? 'vector-zero' : 'vector-invalid', {
        knownUsage: {},
      });
    throw error;
  }
  return {
    vectors,
    usage: {
      providerReportedInputTokens: null,
      preparedInputTokens: null,
      billedTokens: null,
    },
  };
}
