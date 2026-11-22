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
import { hasProviderAuthentication, setHeaderCaseInsensitive } from './openai.js';
import {
  providerCallbackFetch,
  providerCallbackHeaders,
  providerCallbackTarget,
  readProviderJson,
} from './provider-callback.js';

/**
 * Adobe Firefly Services Image5.
 *   POST https://ims-na1.adobelogin.com/ims/token/v3   (client credentials)
 *   POST /v4/images/generate-async                    (x-model-version: image5)
 *   GET  <links.result.href>                          (status polling)
 * Local reference images are uploaded through /v2/storage/image.
 */

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const FIREFLY_CALLBACK_ORIGINS = ['https://firefly-api.adobe.io'];
const IMS_SCOPE = 'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis';
const TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type FireflyAuth = { token: string; clientId?: string };

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

async function acquireToken(
  provider: ResolvedProvider,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<FireflyAuth> {
  const clientId = provider.apiKey;
  if (!clientId) throw missingKeyError(provider);
  if (provider.accessToken) return { token: provider.accessToken, clientId };

  const cached = TOKEN_CACHE.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return { token: cached.token, clientId };
  if (!provider.apiSecret) {
    throw new ImageGenError(
      `${provider.name} requires a client secret or an access token.`,
      `${providerLogLabel(provider)} missing client secret`,
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: provider.apiSecret,
    scope: IMS_SCOPE,
  });
  const json = await requestJson(provider, fetchImpl, IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
    signal: signal ?? null,
    redirect: 'error',
  });
  const token = typeof json.access_token === 'string' ? json.access_token : undefined;
  if (!token) {
    throw new ImageGenError(
      `${provider.name} authentication did not return an access token.`,
      `${providerLogLabel(provider)} missing access token`,
    );
  }
  const expiresIn = typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
    ? json.expires_in
    : 86_400;
  TOKEN_CACHE.set(clientId, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return { token, clientId };
}

function fireflyHeaders(provider: ResolvedProvider, auth: FireflyAuth): Record<string, string> {
  const headers: Record<string, string> = { ...(provider.headers ?? {}) };
  if (auth.clientId) setHeaderCaseInsensitive(headers, 'x-api-key', auth.clientId);
  setHeaderCaseInsensitive(headers, 'Authorization', `Bearer ${auth.token}`);
  setHeaderCaseInsensitive(headers, 'Content-Type', 'application/json');
  setHeaderCaseInsensitive(headers, 'Accept', 'application/json');
  return headers;
}

async function uploadReference(
  provider: ResolvedProvider,
  fetchImpl: typeof fetch,
  root: string,
  headers: Record<string, string>,
  input: ResolvedImageInput,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${root}/v2/storage/image`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': input.mimeType,
      },
      body: input.bytes,
      signal: signal ?? null,
      redirect: 'error',
    });
  } catch (error) {
    throw describeNetworkError(error, provider);
  }
  if (!res.ok) await throwHttpError(res, provider);
  const text = await readBodyText(res, provider);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImageGenError(`${provider.name} returned invalid upload JSON.`, `${providerLogLabel(provider)} invalid upload JSON`);
  }
  const images = isRecord(json) && Array.isArray(json.images) ? json.images : undefined;
  const id = images && isRecord(images[0]) && typeof images[0].id === 'string' ? images[0].id : undefined;
  if (!id) {
    throw new ImageGenError(
      `${provider.name} reference upload did not return an asset id.`,
      `${providerLogLabel(provider)} missing upload id`,
    );
  }
  return id;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError('Firefly job polling'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledError('Firefly job polling'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const adobeFireflyAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!hasProviderAuthentication(provider)) throw missingKeyError(provider);
    const auth = await acquireToken(provider, fetchImpl, signal);
    const headers = fireflyHeaders(provider, auth);
    const root = withDefaultPath(provider.baseUrl, '');

    const referenceBlobs: Array<Record<string, unknown>> = [];
    for (const input of inputs ?? []) {
      if (input.sourceUrl) {
        referenceBlobs.push({ source: { url: input.sourceUrl }, usage: 'general' });
      } else {
        const uploadId = await uploadReference(provider, fetchImpl, root, headers, input, signal);
        referenceBlobs.push({ source: { uploadId }, usage: 'general' });
      }
    }

    const modelSpecificPayload: Record<string, string> = {};
    if (params.promptReasoner) modelSpecificPayload.prompt_reasoner = params.promptReasoner;
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      modelId: remoteModelId,
      numVariations: params.n ?? 1,
      aspectRatio: params.aspectRatio ?? 'auto',
      referenceBlobs,
      ...(params.resolutionLevel ? { resolutionLevel: params.resolutionLevel } : {}),
      ...(params.seed != null ? { seeds: [params.seed] } : {}),
      ...(Object.keys(modelSpecificPayload).length > 0 ? { modelSpecificPayload } : {}),
    };

    const submitHeaders = { ...headers, 'x-model-version': 'image5' };
    const submitted = await requestJson(provider, fetchImpl, `${root}/v4/images/generate-async`, {
      method: 'POST',
      headers: submitHeaders,
      body: JSON.stringify(body),
      signal: signal ?? null,
      redirect: 'error',
    });
    const links = isRecord(submitted.links) ? submitted.links : undefined;
    const resultLink = links && isRecord(links.result) && typeof links.result.href === 'string'
      ? links.result.href
      : typeof submitted.statusUrl === 'string'
        ? submitted.statusUrl
        : undefined;
    if (!resultLink) {
      throw new ImageGenError(
        `${provider.name} submit response did not include a status URL.`,
        `${providerLogLabel(provider)} missing status URL`,
      );
    }
    const callbackPolicy = { allowedOrigins: FIREFLY_CALLBACK_ORIGINS };
    const callback = providerCallbackTarget(provider, resultLink, callbackPolicy);
    const pollHeaders = providerCallbackHeaders(headers, callback.sameOrigin);

    for (;;) {
      await wait(1000, signal);
      const polled = await providerCallbackFetch(provider, callback.url, {
        method: 'GET',
        headers: pollHeaders,
        signal: signal ?? null,
      }, callbackPolicy);
      const status = await readProviderJson(provider, polled.response);
      const state = typeof status.status === 'string' ? status.status.toLowerCase() : undefined;
      if (state === 'succeeded') {
        const result = isRecord(status.result) ? status.result : undefined;
        const outputs = result && Array.isArray(result.outputs) ? result.outputs : undefined;
        const out: RawImageResult[] = [];
        for (const output of outputs ?? []) {
          if (!isRecord(output) || !isRecord(output.image) || typeof output.image.url !== 'string') continue;
          const classified = classifyImageOutput(output.image.url);
          if (classified) out.push({ data: classified });
        }
        if (out.length === 0) {
          throw new ImageGenError(
            `${provider.name} returned no image URL.`,
            `${providerLogLabel(provider)} returned no image URL`,
          );
        }
        const jobId = typeof status.jobId === 'string' ? status.jobId : undefined;
        if (jobId) out[0]!.metadata = coreMetadata({ requestId: jobId });
        return out;
      }
      if (state === 'failed' || state === 'cancelled' || state === 'cancel_pending' || state === 'timeout') {
        throw new ImageGenError(
          `${provider.name} image generation failed.`,
          `${providerLogLabel(provider)} job failed`,
        );
      }
      if (!state) {
        throw new ImageGenError(
          `${provider.name} returned an invalid job status.`,
          `${providerLogLabel(provider)} invalid job status`,
        );
      }
    }
  },
};
