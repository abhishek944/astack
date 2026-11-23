import type { EmbeddingErrorCode } from './schemas.js';

/** Fixed, redacted diagnostics. Provider bodies, input text and credentials never enter an error. */
export type KnownUsage = Readonly<{
  readonly providerReportedInputTokens?: number | null | undefined;
  readonly preparedInputTokens?: number | null | undefined;
}>;

export class EmbeddingsError extends Error {
  readonly code: EmbeddingErrorCode;
  readonly httpStatus: number | undefined;
  /** Counts already known when a later validation or transport step failed; billing stays unknown. */
  readonly knownUsage: KnownUsage | undefined;

  constructor(
    code: EmbeddingErrorCode,
    options?: { httpStatus?: number; knownUsage?: KnownUsage }
  ) {
    super(code);
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.knownUsage = options?.knownUsage;
    this.name = 'EmbeddingsError';
  }
}

export const codeOf = (error: unknown): EmbeddingErrorCode =>
  error instanceof EmbeddingsError ? error.code : 'transport-failed';

/** Only these typed failures may advance an ordinary call to the next configured fallback route. */
export const fallbackCodeForStatus = (status: number): EmbeddingErrorCode | undefined => {
  if (status === 401) return 'http-auth';
  if (status === 404) return 'http-not-found';
  if (status === 429) return 'http-rate-limit';
  return undefined;
};

export const isFallbackError = (error: unknown): boolean =>
  error instanceof EmbeddingsError &&
  (error.code === 'missing-credentials' ||
    error.code === 'http-auth' ||
    error.code === 'http-not-found' ||
    error.code === 'http-rate-limit');

export const statusCode = (status: number): EmbeddingErrorCode => {
  const fallback = fallbackCodeForStatus(status);
  if (fallback !== undefined) return fallback;
  if (status === 403) return 'http-forbidden';
  if (status === 400 || status === 422) return 'http-bad-request';
  if (status >= 500) return 'http-server-error';
  return 'http-bad-request';
};
