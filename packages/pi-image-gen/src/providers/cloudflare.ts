import {
  describeNetworkError,
  ImageGenError,
  missingKeyError,
  readBodyText,
  throwHttpError,
} from '../errors.js';
import { classifyImageOutput } from '../image-input.js';
import { ProviderResultError } from '../core/provider-result.js';
import { coreMetadata } from '../core/usage.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawGenerationMetadata,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { credentialRedirectMode, hasProviderAuthentication, jsonHeaders } from './openai-auth.js';

const WORKERS_AI_MODEL = /^@cf\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * Cloudflare Workers AI REST text-to-image through AI Gateway.
 *
 * Official contract: POST /accounts/{account_id}/ai/run/{model} with the model's
 * input fields directly in the JSON body. Workers AI `@cf/` models require the
 * `cf-aig-gateway-id` header. The REST API wraps the model output in a standard
 * `{ result: { image } }` envelope; the model's raw output is `{ image }`.
 * This adapter deliberately does not claim the provider-native
 * gateway.ai.cloudflare.com paths or OpenAI image endpoints.
 */
export const cloudflareImageAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!hasProviderAuthentication(provider)) throw missingKeyError(provider);
    if (inputs !== undefined && inputs.length > 0)
      throw new ImageGenError(
        'This Cloudflare image route accepts text prompts only; it does not implement image edits.',
        'Cloudflare image input unsupported',
      );
    if (params.n !== undefined && params.n !== 1)
      throw new ImageGenError(
        'This Cloudflare image model generates one image per request; omit n or set it to 1.',
        'Cloudflare n unsupported',
      );
    const unsupported: Array<[string, unknown]> = [
      ['size', params.size],
      ['quality', params.quality],
      ['aspectRatio', params.aspectRatio],
      ['imageSize', params.imageSize],
    ];
    for (const [name, value] of unsupported)
      if (value !== undefined)
        throw new ImageGenError(
          `This Cloudflare image route does not forward ${name}; use local resize for exact output dimensions.`,
          `Cloudflare ${name} unsupported`,
        );
    if (!WORKERS_AI_MODEL.test(remoteModelId))
      throw new ImageGenError(
        'Cloudflare Workers AI image models must use an official @cf/ model id.',
        'Cloudflare model invalid',
      );
    const gatewayId = Object.entries(provider.headers ?? {}).find(
      ([name]) => name.toLowerCase() === 'cf-aig-gateway-id',
    )?.[1];
    if (gatewayId === undefined || !gatewayId.trim())
      throw new ImageGenError(
        'Configure cf-aig-gateway-id in this custom provider\'s headers; Workers AI requests require a gateway ID.',
        'Cloudflare gateway ID missing',
      );

    let url: URL;
    try {
      const base = new URL(provider.baseUrl.replace(/\/+$/, ''));
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
      if (
        (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
        base.username !== '' ||
        base.password !== '' ||
        base.search ||
        base.hash ||
        !/\/ai\/run$/.test(base.pathname)
      ) throw new Error();
      url = new URL(`${base.toString()}/${remoteModelId}`);
    } catch {
      throw new ImageGenError(
        'The Cloudflare base URL must be an HTTPS /ai/run endpoint without credentials, a query or a fragment.',
        'Cloudflare base URL invalid',
      );
    }

    const body: Record<string, unknown> = { prompt: params.prompt };
    if (params.seed !== undefined) body.seed = params.seed;

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: jsonHeaders(provider),
        body: JSON.stringify(body),
        signal: signal ?? null,
        redirect: credentialRedirectMode(provider),
      });
    } catch (error) {
      throw describeNetworkError(error, provider);
    }
    return parseCloudflareImageResponse(res, provider);
  },
};

async function parseCloudflareImageResponse(
  res: Response,
  provider: ResolvedProvider,
): Promise<RawImageResult[]> {
  const requestId = res.headers.get('cf-aig-request-id') ?? res.headers.get('x-request-id') ?? undefined;
  const metadata: RawGenerationMetadata = coreMetadata(requestId ? { requestId } : {});
  try {
    if (!res.ok) await throwHttpError(res, provider);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('json'))
      throw new ImageGenError(
        `${provider.name} returned ${contentType || 'non-JSON'} from the Cloudflare image endpoint.`,
        'Cloudflare image response invalid',
      );
    let json: unknown;
    try {
      json = JSON.parse(await readBodyText(res, provider));
    } catch {
      throw new ImageGenError(
        `${provider.name} returned invalid JSON.`,
        'Cloudflare image response invalid',
      );
    }
    const output = unwrapCloudflareModelOutput(json);
    if (typeof output.image !== 'string')
      throw new ImageGenError(
        `${provider.name} did not return a confirmed base64 image.`,
        'Cloudflare image response invalid',
      );
    const data = classifyImageOutput(output.image);
    if (data === null || data.kind !== 'base64')
      throw new ImageGenError(
        `${provider.name} did not return a confirmed base64 image.`,
        'Cloudflare image response invalid',
      );
    return [{ data, metadata }];
  } catch (error) {
    const safe = error instanceof ImageGenError ? error : new ImageGenError(
      `${provider.name} returned an invalid image response.`,
      'Cloudflare image response invalid',
    );
    throw new ProviderResultError(safe, metadata);
  }
}

function unwrapCloudflareModelOutput(response: unknown): Record<string, unknown> {
  if (!isRecord(response))
    throw new ImageGenError(
      'Cloudflare returned an unexpected image response.',
      'Cloudflare image response invalid',
    );
  if (
    response.success === false ||
    (Array.isArray(response.errors) && response.errors.length > 0)
  )
    throw new ImageGenError(
      'Cloudflare reported that the image request failed.',
      'Cloudflare image response failed',
    );
  if (!Object.hasOwn(response, 'result')) return response;
  if (!isRecord(response.result))
    throw new ImageGenError(
      'Cloudflare returned an unexpected image result.',
      'Cloudflare image response invalid',
    );
  return response.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
