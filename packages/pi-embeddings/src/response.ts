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
