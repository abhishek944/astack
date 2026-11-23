import { EmbeddingsError, statusCode } from './errors.js';

/** Native fetch with fixed URLs, no retries and no response bodies in diagnostics. */
export async function requestJson(args: {
  url: URL;
  body: unknown;
  signal: AbortSignal;
  headers?: Readonly<Record<string, string>>;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(args.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...args.headers,
      },
      body: JSON.stringify(args.body),
      signal: args.signal,
      redirect: 'error',
    });
  } catch (error) {
    if (args.signal.aborted) throw new EmbeddingsError('cancelled');
    void error;
    throw new EmbeddingsError('transport-failed');
  }
  if (!response.ok) {
    const code = statusCode(response.status);
    throw new EmbeddingsError(code, { httpStatus: response.status });
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new EmbeddingsError('provider-response-invalid');
  }
}

/** Fixed origins only; project settings cannot introduce an arbitrary provider endpoint. */
export const fixedOrigin = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EmbeddingsError('configuration-invalid');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  )
    throw new EmbeddingsError('configuration-invalid');
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url;
};

/** One-line header values with no control characters are the only labels this package forwards. */
export const headerValueIsSafe = (value: string): boolean =>
  value.length > 0 && [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
