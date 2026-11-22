import { SIZE_PIXEL_RE } from '../capabilities.js';
import {
  cancelledError,
  describeNetworkError,
  ImageGenError,
  missingKeyError,
  providerLogLabel,
  readBodyText,
  throwHttpError,
} from '../errors.js';
import { classifyImageOutput } from '../image-input.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';
import { coreMetadata } from '../core/usage.js';
import { bearerHeaders, hasProviderAuthentication, setHeaderCaseInsensitive } from './openai.js';
import {
  providerCallbackFetch,
  providerCallbackHeaders,
  providerCallbackTarget,
  readProviderJson,
} from './provider-callback.js';

/**
 * Black Forest Labs FLUX.2 direct API.
 *   POST /v1/{model}                 -> { id, polling_url }
 *   GET  <polling_url>               -> { status, result: { sample } }
 * The global and regional endpoints require polling the URL returned by the
 * submit response, never a constructed status path.
 */

const BFL_CALLBACK_ORIGINS = ['https://api.bfl.ai', 'https://api.eu.bfl.ai', 'https://api.us.bfl.ai'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bflHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers = provider.customAuth
    ? bearerHeaders(provider)
    : { ...(provider.headers ?? {}) };
  if (!provider.customAuth && provider.apiKey) {
    setHeaderCaseInsensitive(headers, 'x-key', provider.apiKey);
  }
  setHeaderCaseInsensitive(headers, 'accept', 'application/json');
  setHeaderCaseInsensitive(headers, 'content-type', 'application/json');
  return headers;
}

async function requestJson(
  provider: ResolvedProvider,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (error) {
    throw describeNetworkError(error, provider);
  }
  if (!res.ok) await throwHttpError(res, provider);
  const text = await readBodyText(res, provider);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImageGenError(`${provider.name} returned invalid JSON.`, `${providerLogLabel(provider)} returned invalid JSON`);
  }
  if (!isRecord(json)) {
    throw new ImageGenError(`${provider.name} returned an invalid response.`, `${providerLogLabel(provider)} returned an invalid response`);
  }
  return json;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError('FLUX task polling'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledError('FLUX task polling'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function requirePublicUrl(inputs: ResolvedImageInput[], provider: ResolvedProvider): string[] {
  return inputs.map((input) => {
    if (!input.sourceUrl) {
      throw new ImageGenError(
        `${provider.name} editing requires public image URLs. Pass an http(s) reference instead of a local file.`,
        `${providerLogLabel(provider)} requires URL input`,
      );
    }
    return input.sourceUrl;
  });
}

export const bflAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!hasProviderAuthentication(provider)) throw missingKeyError(provider);
    const headers = bflHeaders(provider);
    const base = withDefaultPath(provider.baseUrl, '/v1');
    const submitUrl = `${base}/${encodeURIComponent(remoteModelId)}`;
    const body: Record<string, unknown> = { prompt: params.prompt };
    if (params.size) {
      const match = SIZE_PIXEL_RE.exec(params.size.trim());
      if (match) {
        body.width = Number(match[1]);
        body.height = Number(match[2]);
      }
    }
    if (params.outputFormat) body.output_format = params.outputFormat;
    if (params.seed != null) body.seed = params.seed;
    if (params.promptEnhance === false) body.disable_pup = true;
    const referenceUrls = requirePublicUrl(inputs ?? [], provider);
    referenceUrls.forEach((url, index) => {
      body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = url;
    });

    const submitted = await requestJson(provider, fetchImpl, submitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal ?? null,
      redirect: 'error',
    });
    const pollingUrl = typeof submitted.polling_url === 'string' ? submitted.polling_url : undefined;
    if (!pollingUrl) {
      throw new ImageGenError(
        `${provider.name} submit response did not include a polling URL.`,
        `${providerLogLabel(provider)} missing polling URL`,
      );
    }
    const callbackPolicy = { allowedOrigins: BFL_CALLBACK_ORIGINS };
    const callback = providerCallbackTarget(provider, pollingUrl, callbackPolicy);
    const pollHeaders = providerCallbackHeaders(headers, callback.sameOrigin, ['x-key']);

    for (;;) {
      await wait(500, signal);
      const polled = await providerCallbackFetch(provider, callback.url, {
        method: 'GET',
        headers: pollHeaders,
        signal: signal ?? null,
      }, callbackPolicy);
      const status = await readProviderJson(provider, polled.response);
      const state = typeof status.status === 'string' ? status.status.toLowerCase() : undefined;
      if (state === 'ready') {
        const result = isRecord(status.result) ? status.result : undefined;
        const sample = typeof result?.sample === 'string' ? result.sample : undefined;
        if (!sample) {
          throw new ImageGenError(
            `${provider.name} returned no image URL.`,
            `${providerLogLabel(provider)} returned no image URL`,
          );
        }
        const classified = classifyImageOutput(sample);
        if (!classified) {
          throw new ImageGenError(
            `${provider.name} returned no image URL.`,
            `${providerLogLabel(provider)} returned no image URL`,
          );
        }
        const requestId = typeof submitted.id === 'string' ? submitted.id : undefined;
        return [{
          data: classified,
          ...(requestId ? { metadata: coreMetadata({ requestId }) } : {}),
        }];
      }
      if (state === 'error' || state === 'failed') {
        throw new ImageGenError(
          `${provider.name} image generation failed.`,
          `${providerLogLabel(provider)} task failed`,
        );
      }
      if (!state) {
        throw new ImageGenError(
          `${provider.name} returned an invalid task status.`,
          `${providerLogLabel(provider)} invalid task status`,
        );
      }
    }
  },
};
