import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { safeFetch } from '@amaster.ai/pi-shared';
import {
  ImageGenError,
  providerLogLabel,
  readBodyText,
} from '../errors.js';
import type { ResolvedProvider } from '../types.js';

/**
 * Validate and fetch provider-returned callback URLs with a DNS-pinned
 * outbound path. Origin allowlisting happens before the request. Public-IP
 * checks stay enforced for public hosts and documented off-origin hosts;
 * trustedHosts is relaxed only for same-origin callbacks to an explicitly
 * configured HTTP literal loopback address. Named localhost hosts use a
 * dedicated loopback-only resolver below, preserving the configured Host
 * header while pinning the connection to a validated loopback address.
 */

export type ProviderCallbackPolicy = {
  /** Additional exact origins documented by a built-in provider. */
  allowedOrigins?: readonly string[];
  /** Header names that may be forwarded to a documented off-origin callback. */
  offOriginHeaders?: readonly string[];
};

function origin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function isNamedLoopbackHost(host: string): boolean {
  const lower = host.replace(/^\[|\]$/g, '').toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost');
}

function isNamedLoopbackBase(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === 'http:' && isNamedLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isLiteralLoopbackHost(host: string): boolean {
  const hostname = host.replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function isConfiguredLiteralLoopback(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === 'http:' && isLiteralLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return address.startsWith('127.');
  if (family === 6) return address.toLowerCase() === '::1' ||
    address.toLowerCase() === '0:0:0:0:0:0:0:1';
  return false;
}

type PinnedAddress = { address: string; family: 4 | 6 };

async function resolveLoopbackAddresses(hostname: string): Promise<PinnedAddress[]> {
  const answers = await dnsLookup(hostname, { all: true }).catch(() => []);
  const loopback = answers
    .filter((answer) => isLoopbackAddress(answer.address))
    .map((answer) => ({ address: answer.address, family: answer.family === 6 ? 6 as const : 4 as const }))
    .sort((a, b) => a.family - b.family);
  if (loopback.length > 0) return loopback;
  // `.localhost` is a reserved special-use suffix. If DNS is absent, use the
  // conventional IPv4 loopback; if DNS resolved only non-loopback addresses,
  // reject instead of silently redirecting the request.
  if (answers.length === 0 && isNamedLoopbackHost(hostname)) {
    return [{ address: '127.0.0.1', family: 4 }];
  }
  throw new Error('loopback resolution rejected');
}

type CallbackHeaders = Headers | string[][] | Record<string, string | readonly string[]>;

function headerRecord(init?: CallbackHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  const append = (name: string, value: string): void => {
    const key = Object.keys(out).find((existing) => existing.toLowerCase() === name.toLowerCase());
    if (key) delete out[key];
    out[name] = value;
  };
  if (!init) return out;
  if (init instanceof Headers) {
    init.forEach((value, name) => append(name, value));
  } else if (Array.isArray(init)) {
    for (const pair of init) {
      if (pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
        append(pair[0], pair[1]);
      }
    }
  } else {
    for (const [name, value] of Object.entries(init)) {
      if (typeof value === 'string') append(name, value);
      else for (const item of value) append(name, item);
    }
  }
  return out;
}

/**
 * Node's built-in fetch rejects a `Host` override and pi-shared rejects named
 * loopback before trustedHosts are applied. This small http client is limited
 * by the caller to an already origin-validated same-origin localhost callback
 * and pins DNS to a verified loopback answer for the connection.
 */
async function safeNamedLoopbackFetch(url: URL, init: RequestInit): Promise<Response> {
  if (url.protocol !== 'http:') throw new Error('named loopback requires http');
  if (!isNamedLoopbackHost(url.hostname)) throw new Error('not a named loopback host');
  const targets = await resolveLoopbackAddresses(url.hostname);
  const headers = headerRecord(init.headers);
  const hostKey = Object.keys(headers).find((name) => name.toLowerCase() === 'host');
  if (hostKey) delete headers[hostKey];
  headers.host = url.host;

  const attempt = (target: PinnedAddress): Promise<Response> => new Promise<Response>((resolve, reject) => {
    if (init.signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    let incoming: IncomingMessage | undefined;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      init.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      const error = new Error('aborted');
      request.destroy(error);
      incoming?.destroy(error);
    };
    const request = httpRequest({
      protocol: 'http:',
      hostname: url.hostname,
      port: url.port || 80,
      method: init.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      headers,
      agent: false,
      family: target.family,
      lookup: (_hostname, _options, callback) => {
        callback(null, target.address, target.family);
      },
    }, (response) => {
      incoming = response;
      response.once('end', cleanup);
      response.once('close', cleanup);
      response.once('error', cleanup);
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(name, item);
        } else if (value != null) {
          responseHeaders.set(name, String(value));
        }
      }
      const status = response.statusCode ?? 502;
      const method = (init.method ?? 'GET').toUpperCase();
      const body = method === 'HEAD' || status === 204 || status === 304
        ? null
        : Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>;
      try {
        resolve(new Response(body, {
          status,
          statusText: response.statusMessage ?? '',
          headers: responseHeaders,
        }));
      } catch (error) {
        response.destroy();
        cleanup();
        reject(error);
      }
    });
    init.signal?.addEventListener('abort', onAbort, { once: true });
    request.once('error', (error) => {
      cleanup();
      reject(error);
    });
    if (typeof init.body === 'string' || init.body instanceof Uint8Array) request.end(init.body);
    else request.end();
  });

  for (const [index, target] of targets.entries()) {
    try {
      return await attempt(target);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const canRetry = code === 'ECONNREFUSED' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH';
      if (!canRetry || index === targets.length - 1) throw error;
    }
  }
  throw new Error('no loopback address connected');
}

export function providerCallbackTarget(
  provider: ResolvedProvider,
  value: string,
  policy: ProviderCallbackPolicy = {},
): { url: string; sameOrigin: boolean } {
  const baseOrigin = origin(provider.baseUrl);
  if (!baseOrigin) {
    throw new ImageGenError(
      `${provider.name} has an invalid provider endpoint.`,
      `${providerLogLabel(provider)} invalid base URL`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw callbackError(provider);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw callbackError(provider);
  }
  const extraOrigins = provider.builtIn
    ? (policy.allowedOrigins ?? []).map((candidate) => origin(candidate)).filter((item): item is string => item != null)
    : [];
  const allowed = new Set<string>([baseOrigin, ...extraOrigins]);
  const sameOrigin = parsed.origin === baseOrigin;
  if (!allowed.has(parsed.origin) || (parsed.protocol === 'http:' && !sameOrigin)) {
    throw callbackError(provider);
  }
  return { url: parsed.toString(), sameOrigin };
}

export async function providerCallbackFetch(
  provider: ResolvedProvider,
  value: string,
  init: RequestInit,
  policy: ProviderCallbackPolicy = {},
): Promise<{ response: Response; url: string; sameOrigin: boolean }> {
  const callback = providerCallbackTarget(provider, value, policy);
  let response: Response;
  try {
    if (callback.sameOrigin && isNamedLoopbackBase(provider.baseUrl)) {
      response = await safeNamedLoopbackFetch(new URL(callback.url), init);
    } else {
      // Only an explicitly configured HTTP literal loopback endpoint may
      // bypass public-IP checks in pi-shared.
      const trustedHosts = callback.sameOrigin && isConfiguredLiteralLoopback(provider.baseUrl)
        ? [new URL(provider.baseUrl).hostname.replace(/^\[|\]$/g, '')]
        : [];
      response = await safeFetch(callback.url, init, {
        trustedHosts,
        maxRedirects: 0,
      });
    }
  } catch {
    throw callbackError(provider);
  }
  return { response, url: callback.url, sameOrigin: callback.sameOrigin };
}

export async function readProviderJson(
  provider: ResolvedProvider,
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ImageGenError(
      `${provider.name} callback request failed.`,
      `${providerLogLabel(provider)} callback HTTP ${response.status}`,
    );
  }
  const text = await readBodyText(response, provider);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImageGenError(`${provider.name} returned invalid JSON.`, `${providerLogLabel(provider)} returned invalid JSON`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ImageGenError(
      `${provider.name} returned an invalid callback response.`,
      `${providerLogLabel(provider)} invalid callback response`,
    );
  }
  return json as Record<string, unknown>;
}

/** Keep only headers required by the callback protocol when crossing origins. */
export function providerCallbackHeaders(
  headers: Record<string, string>,
  sameOrigin: boolean,
  offOriginHeaders: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = { accept: 'application/json' };
  if (sameOrigin) {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'content-type') out[name] = value;
    }
    return out;
  }
  for (const name of offOriginHeaders) {
    const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (found) out[found[0]] = found[1];
  }
  return out;
}

function callbackError(provider: ResolvedProvider): ImageGenError {
  return new ImageGenError(
    `${provider.name} returned an unsafe callback URL.`,
    `${providerLogLabel(provider)} unsafe callback URL`,
  );
}
