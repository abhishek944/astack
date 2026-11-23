import type { EmbeddingContext, EmbeddingRouteId, EmbeddingSpace } from './schemas.js';

/** The prepared form is provider-owned and never exposed as a model-facing caller input. */
export type PreparedInput =
  | Readonly<{ readonly kind: 'text'; readonly text: string; readonly tokenCount: number | null }>
  | Readonly<{ readonly kind: 'tokens'; readonly tokens: readonly number[] }>;

export type ProviderUsage = Readonly<{
  readonly providerReportedInputTokens: number | null;
  readonly preparedInputTokens: number | null;
  readonly billedTokens: number | null;
}>;

export type ProviderBatchResult = Readonly<{
  readonly vectors: readonly (readonly number[])[];
  readonly usage: ProviderUsage;
}>;

export interface EmbeddingsProvider {
  readonly route: EmbeddingRouteId;
  readonly model: string;
  readonly space: EmbeddingSpace;
  /** Mandatory provider request boundaries. Infinity means no declared request-level ceiling. */
  readonly maxRequestInputs: number;
  readonly maxRequestTokens: number;
  prepare(text: string, signal: AbortSignal): Promise<PreparedInput>;
  embed(
    inputs: readonly PreparedInput[],
    signal: AbortSignal,
    context: EmbeddingContext | undefined
  ): Promise<ProviderBatchResult>;
  close(): Promise<void>;
}
