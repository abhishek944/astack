import { randomUUID } from 'node:crypto';
import { EmbeddingsError, codeOf, isFallbackError } from './errors.js';
import type { AcquiredProvider } from './providers.js';
import type { PreparedInput } from './provider-types.js';
import {
  EMBEDDINGS_PROTOCOL_VERSION,
  EMBEDDING_NORMALIZATION_VERSION,
  type EmbeddingAttempt,
  type EmbeddingCompareEntry,
  type EmbeddingCompareResult,
  type EmbeddingContext,
  type EmbeddingErrorCode,
  type EmbeddingGeneration,
  type EmbeddingOutcome,
  type EmbeddingRequest,
  type EmbeddingResult,
  type EmbeddingRoute,
} from './schemas.js';

type Pending = Readonly<{ readonly index: number; readonly input: PreparedInput }>;

type ExecuteArgs = Readonly<{
  routes: readonly EmbeddingRoute[];
  request: EmbeddingRequest;
  context: EmbeddingContext | undefined;
  signal: AbortSignal;
  allowFallback: boolean;
  acquire: (route: EmbeddingRoute, signal: AbortSignal) => Promise<AcquiredProvider>;
  idPrefix?: string;
}>;

const cancelled = (index: number): EmbeddingOutcome => ({
  status: 'error',
  index,
  code: 'cancelled',
  attemptId: null,
});

const unstarted = (index: number): EmbeddingOutcome => ({
  status: 'error',
  index,
  code: 'unstarted',
  attemptId: null,
});

const preparedTokenCount = (input: PreparedInput): number =>
  input.kind === 'tokens' ? input.tokens.length : (input.tokenCount ?? 0);

const generationKey = (generation: EmbeddingGeneration): string =>
  `${generation.provider}\u0000${generation.model}\u0000${JSON.stringify(generation.space)}`;

/**
 * Record the complete set of actual generations. Singular metadata is set only when one generation
 * produced every vector; a mixed fallback never collapses into a guessed route or space.
 */
const generationsOf = (outcomes: readonly EmbeddingOutcome[]): EmbeddingGeneration[] => {
  const byKey = new Map<string, EmbeddingGeneration>();
  for (const outcome of outcomes) {
    if (outcome.status !== 'success') continue;
    const generation: EmbeddingGeneration = {
      provider: outcome.route,
      model: outcome.model,
      space: outcome.space,
    };
    byKey.set(generationKey(generation), generation);
  }
  return [...byKey.values()];
};

const resultMetadata = (outcomes: readonly EmbeddingOutcome[]) => {
  const generations = generationsOf(outcomes);
  const only = generations.length === 1 ? generations[0] : undefined;
  return {
    provider: only?.provider ?? null,
    model: only?.model ?? null,
    space: only?.space ?? null,
    generations,
  };
};

/**
 * Runs one ordinary call or one explicit comparison entry. Successful inputs are never replayed on a
 * fallback route; only unfinished inputs continue. Every input keeps its original zero-based index.
 */
export async function executeEmbeddings(args: ExecuteArgs): Promise<EmbeddingResult> {
  const prefix = args.idPrefix ?? randomUUID();
  const outcomes = new Array<EmbeddingOutcome | undefined>(args.request.inputs.length);
  const attempts: EmbeddingAttempt[] = [];
  const failureByIndex = new Map<number, { readonly code: EmbeddingErrorCode; readonly attemptId: string | null }>();
  let remaining = args.request.inputs.map((_input, index) => index);

  for (const [routeIndex, route] of args.routes.entries()) {
    if (remaining.length === 0) break;
    if (args.signal.aborted) {
      for (const index of remaining) outcomes[index] = cancelled(index);
      remaining = [];
      break;
    }

    let acquired: AcquiredProvider | undefined;
    try {
      acquired = await args.acquire(route, args.signal);
    } catch (error) {
      const code = codeOf(error);
      const attemptId = `${prefix}-${routeIndex}-${attempts.length}`;
      attempts.push({
        id: attemptId,
        route: route.provider,
        model: route.model,
        routeIndex,
        status: 'error',
        usage: null,
        errorCode: code,
      });
      for (const index of remaining) failureByIndex.set(index, { code, attemptId });
      if (args.allowFallback && isFallbackError(error)) continue;
      for (const index of remaining) outcomes[index] = { status: 'error', index, code, attemptId };
      remaining = [];
      continue;
    }

    const unfinished: number[] = [];
    {
      const provider = acquired.provider;
      const prepared: Pending[] = [];
      for (const index of remaining) {
        if (args.signal.aborted) {
          outcomes[index] = cancelled(index);
          continue;
        }
        try {
          const input = await provider.prepare(args.request.inputs[index] ?? '', args.signal);
          prepared.push({ index, input });
        } catch (error) {
          if (args.signal.aborted) outcomes[index] = cancelled(index);
          else {
            const code = codeOf(error);
            if (args.allowFallback && isFallbackError(error)) {
              // Preflight HTTP and credential failures follow the same fallback rule as embed failures.
              // The failed index stays pending; successful inputs are never replayed on the next route.
              const attemptId = `${prefix}-${routeIndex}-${attempts.length}`;
              attempts.push({
                id: attemptId,
                route: route.provider,
                model: provider.model,
                routeIndex,
                status: 'error',
                usage: null,
                errorCode: code,
              });
              failureByIndex.set(index, { code, attemptId });
              unfinished.push(index);
            } else {
              failureByIndex.set(index, { code, attemptId: null });
              outcomes[index] = { status: 'error', index, code, attemptId: null };
            }
          }
        }
      }

      let batch: Pending[] = [];
      let tokens = 0;
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return;
        const captured = batch;
        batch = [];
        tokens = 0;
        const attemptId = `${prefix}-${routeIndex}-${attempts.length}`;
        const preparedForBatch = captured.reduce((sum, entry) => sum + preparedTokenCount(entry.input), 0);
        const attempt: EmbeddingAttempt = {
          id: attemptId,
          route: route.provider,
          model: provider.model,
          routeIndex,
          status: 'success',
          usage: {
            providerReportedInputTokens: null,
            preparedInputTokens: preparedForBatch > 0 ? preparedForBatch : null,
            billedTokens: null,
          },
        };
        attempts.push(attempt);
        if (args.signal.aborted) {
          attempt.status = 'cancelled';
          for (const entry of captured) outcomes[entry.index] = cancelled(entry.index);
          unfinished.push(...captured.map((entry) => entry.index));
          return;
        }
        try {
          const result = await provider.embed(
            captured.map((entry) => entry.input),
            args.signal,
            args.context
          );
          attempt.usage = result.usage;
          if (result.vectors.length !== captured.length)
            throw new EmbeddingsError('provider-response-mismatch');
          for (const [offset, entry] of captured.entries()) {
            const vector = result.vectors[offset];
            if (vector === undefined) throw new EmbeddingsError('provider-response-mismatch');
            outcomes[entry.index] = {
              status: 'success',
              index: entry.index,
              vector: [...vector],
              route: route.provider,
              model: provider.model,
              space: provider.space,
              attemptId,
              normalization: EMBEDDING_NORMALIZATION_VERSION,
            };
          }
        } catch (error) {
          const code = codeOf(error);
          attempt.status = 'error';
          attempt.errorCode = code;
          const known = error instanceof EmbeddingsError ? error.knownUsage : undefined;
          if (known !== undefined && attempt.usage !== null)
            attempt.usage = {
              providerReportedInputTokens: known.providerReportedInputTokens ?? attempt.usage.providerReportedInputTokens,
              preparedInputTokens: known.preparedInputTokens ?? attempt.usage.preparedInputTokens,
              billedTokens: null,
            };
          for (const entry of captured) failureByIndex.set(entry.index, { code, attemptId });
          if (args.signal.aborted || code === 'cancelled') {
            for (const entry of captured) outcomes[entry.index] = cancelled(entry.index);
          } else if (args.allowFallback && isFallbackError(error)) {
            unfinished.push(...captured.map((entry) => entry.index));
          } else {
            for (const entry of captured)
              outcomes[entry.index] = { status: 'error', index: entry.index, code, attemptId };
          }
        }
      };

      for (const entry of prepared) {
        const count = preparedTokenCount(entry.input);
        if (batch.length > 0 && (batch.length + 1 > provider.maxRequestInputs || tokens + count > provider.maxRequestTokens))
          await flush();
        batch = [...batch, entry];
        tokens += count;
      }
      await flush();
    }
    remaining = unfinished;
  }

  for (const index of remaining) {
    if (outcomes[index] === undefined)
      outcomes[index] = args.signal.aborted
        ? cancelled(index)
        : failureByIndex.get(index) === undefined
          ? unstarted(index)
          : {
              status: 'error',
              index,
              code: failureByIndex.get(index)?.code ?? 'unstarted',
              attemptId: failureByIndex.get(index)?.attemptId ?? null,
            };
  }
  const allOutcomes = outcomes.map((outcome, index) => outcome ?? unstarted(index));
  return {
    schemaVersion: EMBEDDINGS_PROTOCOL_VERSION,
    ...resultMetadata(allOutcomes),
    outcomes: allOutcomes,
    attempts,
  };
}

/** Explicit comparison: configured entries only, no fallback, no ranking and no default mutation. */
export async function executeCompare(args: {
  routes: readonly EmbeddingRoute[];
  request: EmbeddingRequest;
  context: EmbeddingContext | undefined;
  signal: AbortSignal;
  acquire: (route: EmbeddingRoute, signal: AbortSignal) => Promise<AcquiredProvider>;
}): Promise<EmbeddingCompareResult> {
  const entries: EmbeddingCompareEntry[] = [];
  for (const [index, route] of args.routes.entries()) {
    if (args.signal.aborted) {
      entries.push({
        route: route.provider,
        model: route.model,
        status: 'cancelled',
        result: {
          schemaVersion: EMBEDDINGS_PROTOCOL_VERSION,
          provider: null,
          model: null,
          space: null,
          generations: [],
          outcomes: args.request.inputs.map((_input, offset) => cancelled(offset)),
          attempts: [],
        },
      });
      continue;
    }
    const result = await executeEmbeddings({
      routes: [route],
      request: args.request,
      context: args.context,
      signal: args.signal,
      allowFallback: false,
      acquire: args.acquire,
      idPrefix: `compare-${index}-${randomUUID()}`,
    });
    entries.push({
      route: route.provider,
      model: route.model,
      status: result.outcomes.every((outcome) => outcome.status === 'success')
        ? 'success'
        : args.signal.aborted
          ? 'cancelled'
          : 'error',
      result,
    });
  }
  return { schemaVersion: EMBEDDINGS_PROTOCOL_VERSION, entries };
}
