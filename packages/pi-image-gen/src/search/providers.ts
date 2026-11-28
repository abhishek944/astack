import { safeFetch } from '@amaster.ai/pi-shared';
import { readResponseBytes } from '../core/response.js';
import { imageSearchCredential, isRecord } from './config.js';
import { ImageSearchError } from './errors.js';
import type { ImageSearchCandidate, ImageSearchParallelMode, ImageSearchProvider, ImageSearchSettings } from './types.js';

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const FALLBACK_STATUSES = new Set([401, 403, 404, 429]);
const DEFAULT_PARALLEL_MODE: ImageSearchParallelMode = 'fast';
const DEFAULT_OPENAI_RESPONSES_MODEL = 'gpt-6.2-astra';
type Row = Record<string, unknown>;

/** Bound the wait too: safeFetch's DNS lookup does not observe AbortSignal. */
function fetchSearch(url: URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
      return;
    }
    // maxRedirects, not RequestInit.redirect, owns safeFetch redirect policy.
    // Never forward provider credentials to a redirect target.
    void safeFetch(url, init, { maxRedirects: 0 }).then((response) => {
      if (signal.aborted) void response.body?.cancel().catch(() => {});
      resolve(response);
    }, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : undefined;
}

/** Return only HTTP(S) links, never data URIs, credentials or executable schemes. */
function link(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function dimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function child(row: Row, key: string): Row {
  return isRecord(row[key]) ? row[key] : {};
}

function requireCredential(provider: ImageSearchProvider, settings: ImageSearchSettings): string {
  const key = imageSearchCredential(provider, settings);
  if (!key) {
    throw new ImageSearchError(`Image search credentials are missing for ${provider}. Configure its search apiKey or environment variable.`, 'credentials', true);
  }
  return key;
}

/** Shared JSON boundary: no provider response body is ever copied into an error message. */
async function fetchJson(provider: ImageSearchProvider, url: URL, init: RequestInit, signal: AbortSignal): Promise<Row> {
  signal.throwIfAborted();
  const response = await fetchSearch(url, init, signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ImageSearchError(`${provider} image search returned HTTP ${response.status}.`, 'http', FALLBACK_STATUSES.has(response.status));
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readResponseBytes(response, MAX_JSON_BYTES)));
  } catch {
    signal.throwIfAborted();
    throw new ImageSearchError(`${provider} returned an unreadable or oversized search response.`, 'response');
  }
  if (!isRecord(body)) throw new ImageSearchError(`${provider} returned an invalid search response.`, 'response');
  if (body.error) throw new ImageSearchError(`${provider} reported an image search error.`, 'response');
  return body;
}

async function withProviderErrors<T>(provider: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof ImageSearchError) throw error;
    throw new ImageSearchError(`${provider} image search could not reach the provider. No automatic retry was made.`, 'network');
  }
}

function unique(candidates: ImageSearchCandidate[], limit: number): ImageSearchCandidate[] {
  const images: ImageSearchCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.imageUrl)) continue;
    seen.add(candidate.imageUrl);
    images.push(candidate);
    if (images.length === limit) break;
  }
  return images;
}

type TavilyImage = { imageUrl: string; title?: string };

function tavilyImage(value: unknown): TavilyImage | undefined {
  const rawUrl = typeof value === 'string' ? value : isRecord(value) ? value.url : undefined;
  const imageUrl = link(rawUrl);
  if (!imageUrl) return undefined;
  const title = isRecord(value) ? text(value.description) : undefined;
  return { imageUrl, ...(title ? { title } : {}) };
}

function tavilyImages(value: unknown): TavilyImage[] {
  if (!Array.isArray(value)) return [];
  const images: TavilyImage[] = [];
  for (const entry of value) {
    const image = tavilyImage(entry);
    if (image) images.push(image);
  }
  return images;
}

async function searchTavily(query: string, limit: number, settings: ImageSearchSettings, signal: AbortSignal): Promise<ImageSearchCandidate[]> {
  const key = requireCredential('tavily', settings);
  const url = new URL('https://api.tavily.com/search');
  const init: RequestInit = {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      include_images: true,
      include_image_descriptions: true,
      max_results: limit,
    }),
  };
  return withProviderErrors('tavily', signal, async () => {
    const body = await fetchJson('tavily', url, init, signal);
    if (body.detail) throw new ImageSearchError('tavily reported an image search error.', 'response');
    const candidates: ImageSearchCandidate[] = [];
    for (const image of tavilyImages(body.images)) candidates.push({ provider: 'tavily', ...image });
    const results = Array.isArray(body.results) ? body.results : [];
    for (const row of results) {
      if (!isRecord(row)) continue;
      const sourcePageUrl = link(row.url);
      const providerResultId = text(row.id);
      for (const image of tavilyImages(row.images)) {
        candidates.push({
          provider: 'tavily',
          ...image,
          ...(sourcePageUrl ? { sourcePageUrl } : {}),
          ...(providerResultId ? { providerResultId } : {}),
        });
      }
    }
    return unique(candidates, limit);
  });
}

function parallelImage(value: unknown): ImageSearchCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const imageUrl = link(value.image_url);
  if (!imageUrl) return undefined;
  const title = text(value.title);
  const sourcePageUrl = link(value.source_page_url);
  const width = dimension(value.width);
  const height = dimension(value.height);
  return {
    provider: 'parallel',
    imageUrl,
    ...(title ? { title } : {}),
    ...(sourcePageUrl ? { sourcePageUrl } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

async function searchParallel(query: string, limit: number, settings: ImageSearchSettings, signal: AbortSignal): Promise<ImageSearchCandidate[]> {
  const key = requireCredential('parallel', settings);
  const configuredMode = settings.providers?.parallel?.mode;
  const mode = configuredMode === 'advanced' ? 'advanced' : DEFAULT_PARALLEL_MODE;
  const url = new URL('https://api.parallel.ai/v1/images/search');
  const init: RequestInit = {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': key,
    },
    body: JSON.stringify({
      search_queries: [query],
      mode,
      advanced_settings: { max_results: limit },
    }),
  };
  return withProviderErrors('parallel', signal, async () => {
    const body = await fetchJson('parallel', url, init, signal);
    if (!Array.isArray(body.results)) throw new ImageSearchError('parallel returned an invalid image list.', 'response');
    const candidates: ImageSearchCandidate[] = [];
    for (const row of body.results) {
      const image = parallelImage(row);
      if (image) candidates.push(image);
    }
    return unique(candidates, limit);
  });
}

function openAiImage(value: unknown): ImageSearchCandidate | undefined {
  if (!isRecord(value) || value.type !== 'image_result') return undefined;
  const imageUrl = link(value.image_url);
  if (!imageUrl) return undefined;
  const title = text(value.caption);
  const sourcePageUrl = link(value.source_website_url);
  const thumbnailUrl = link(value.thumbnail_url);
  return {
    provider: 'openai-responses',
    imageUrl,
    ...(title ? { title } : {}),
    ...(sourcePageUrl ? { sourcePageUrl } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}

function openAiResults(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  const results: Row[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.type !== 'web_search_call') continue;
    if (item.status !== undefined && item.status !== 'completed') continue;
    if (!Array.isArray(item.results)) continue;
    for (const row of item.results) if (isRecord(row)) results.push(row);
  }
  return results;
}

async function searchOpenAIResponses(query: string, limit: number, settings: ImageSearchSettings, signal: AbortSignal): Promise<ImageSearchCandidate[]> {
  const key = requireCredential('openai-responses', settings);
  const configuredModel = settings.providers?.['openai-responses']?.model?.trim();
  const url = new URL('https://api.openai.com/v1/responses');
  const init: RequestInit = {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: configuredModel || DEFAULT_OPENAI_RESPONSES_MODEL,
      input: query,
      tools: [{
        type: 'web_search',
        search_content_types: ['image'],
        image_settings: { max_results: limit, caption: true },
      }],
      include: ['web_search_call.results'],
    }),
  };
  return withProviderErrors('openai-responses', signal, async () => {
    const body = await fetchJson('openai-responses', url, init, signal);
    if (body.status === 'incomplete' || body.status === 'failed') {
      throw new ImageSearchError('openai-responses did not complete the image search.', 'response');
    }
    if (!Array.isArray(body.output)) throw new ImageSearchError('openai-responses returned an invalid response.', 'response');
    const candidates: ImageSearchCandidate[] = [];
    for (const row of openAiResults(body.output)) {
      const image = openAiImage(row);
      if (image) candidates.push(image);
    }
    return unique(candidates, limit);
  });
}

/** Each adapter owns its provider's wire shape; the caller sees one candidate contract. */
function normalize(provider: ImageSearchProvider, row: Row): ImageSearchCandidate | undefined {
  const properties = child(row, 'properties');
  const imageUrl = link(provider === 'serper' ? row.imageUrl : provider === 'brave' ? properties.url :
    provider === 'serpapi' ? row.original : row.url);
  if (!imageUrl) return undefined;
  const values = {
    title: text(row.title),
    providerResultId: text(provider === 'serpapi' ? row.image_id : row.id),
    thumbnailUrl: link(provider === 'serper' ? row.thumbnailUrl : provider === 'brave' ? child(row, 'thumbnail').src : row.thumbnail),
    sourcePageUrl: link(provider === 'serper' || provider === 'serpapi' ? row.link : provider === 'brave' ? row.url : row.foreign_landing_url),
    width: dimension(provider === 'serper' ? row.imageWidth : provider === 'brave' ? properties.width : provider === 'serpapi' ? row.original_width : row.width),
    height: dimension(provider === 'serper' ? row.imageHeight : provider === 'brave' ? properties.height : provider === 'serpapi' ? row.original_height : row.height),
    ...(provider === 'openverse' ? {
      creator: text(row.creator), creatorUrl: link(row.creator_url),
      license: text(row.license), licenseUrl: link(row.license_url), attribution: text(row.attribution),
    } : {}),
  };
  // Omit unavailable metadata rather than inventing a license, title or dimensions.
  return { provider, imageUrl, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) };
}

export async function searchProvider(
  provider: ImageSearchProvider,
  query: string,
  limit: number,
  settings: ImageSearchSettings,
  signal: AbortSignal,
): Promise<ImageSearchCandidate[]> {
  if (provider === 'tavily') return searchTavily(query, limit, settings, signal);
  if (provider === 'parallel') return searchParallel(query, limit, settings, signal);
  if (provider === 'openai-responses') return searchOpenAIResponses(query, limit, settings, signal);
  const key = imageSearchCredential(provider, settings);
  if (!key && provider !== 'openverse') {
    throw new ImageSearchError(`Image search credentials are missing for ${provider}. Configure its search apiKey or environment variable.`, 'credentials', true);
  }
  let url: URL;
  const init: RequestInit = { signal, redirect: 'error', headers: { Accept: 'application/json' } };
  if (provider === 'serper') {
    url = new URL('https://google.serper.dev/images');
    init.method = 'POST';
    init.headers = { ...init.headers, 'Content-Type': 'application/json', 'X-API-KEY': key! };
    init.body = JSON.stringify({ q: query, num: limit });
  } else if (provider === 'brave') {
    url = new URL('https://api.search.brave.com/res/v1/images/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    url.searchParams.set('safesearch', 'strict');
    init.headers = { ...init.headers, 'X-Subscription-Token': key! };
  } else if (provider === 'serpapi') {
    url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_images');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', key!);
    url.searchParams.set('safe', 'active');
  } else {
    url = new URL('https://api.openverse.org/v1/images/');
    url.searchParams.set('q', query);
    url.searchParams.set('page_size', String(limit));
    url.searchParams.set('mature', 'false');
    if (key) init.headers = { ...init.headers, Authorization: `Bearer ${key}` };
  }
  try {
    const body = await fetchJson(provider, url, init, signal);
    // Provider error payloads are not safe user messages, and are not empty searches.
    if (provider === 'serpapi' && child(body, 'search_metadata').status === 'Error') {
      throw new ImageSearchError(`${provider} reported an image search error.`, 'response');
    }
    const rows = body[provider === 'serper' ? 'images' : provider === 'serpapi' ? 'images_results' : 'results'];
    // SerpApi can omit images_results on a documented no-results response.
    if (provider === 'serpapi' && rows === undefined && child(body, 'search_information').image_results_state === 'Fully empty') return [];
    if (!Array.isArray(rows)) throw new ImageSearchError(`${provider} returned an invalid image list.`, 'response');
    const images: ImageSearchCandidate[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const image = normalize(provider, row);
      if (!image || seen.has(image.imageUrl)) continue;
      seen.add(image.imageUrl);
      images.push(image);
      if (images.length === limit) break;
    }
    return images;
  } catch (error) {
    if (signal.aborted) throw error; // The orchestration boundary classifies cancellation/deadline.
    if (error instanceof ImageSearchError) throw error;
    throw new ImageSearchError(`${provider} image search could not reach the provider. No automatic retry was made.`, 'network');
  }
}
