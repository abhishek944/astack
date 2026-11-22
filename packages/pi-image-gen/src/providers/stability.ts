import {
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

/**
 * Stability AI /v2beta image generation. Requests are multipart/form-data and
 * this adapter asks for the documented application/json response so images are
 * returned as base64. Async result endpoints are not needed by these services.
 */

const OUTPUT_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stabilityHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers = bearerHeaders(provider);
  setHeaderCaseInsensitive(headers, 'accept', 'application/json');
  return headers;
}

function endpoint(provider: ResolvedProvider, remoteModelId: string): { url: string; model?: string } {
  const base = withDefaultPath(provider.baseUrl, '/v2beta');
  if (remoteModelId === 'stable-image-core') {
    return { url: `${base}/stable-image/generate/core` };
  }
  if (remoteModelId === 'stable-image-ultra') {
    return { url: `${base}/stable-image/generate/ultra` };
  }
  return { url: `${base}/stable-image/generate/sd3`, model: remoteModelId };
}

export const stabilityAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!hasProviderAuthentication(provider)) throw missingKeyError(provider);
    const headers = stabilityHeaders(provider);
    const target = endpoint(provider, remoteModelId);
    const form = new FormData();
    form.append('prompt', params.prompt);
    if (target.model) form.append('model', target.model);
    if (params.aspectRatio) form.append('aspect_ratio', params.aspectRatio);
    if (params.negativePrompt) form.append('negative_prompt', params.negativePrompt);
    if (params.seed != null) form.append('seed', String(params.seed));
    if (params.outputFormat) form.append('output_format', params.outputFormat);
    if (inputs && inputs.length > 0) {
      const input = inputs[0]!;
      form.append('mode', 'image-to-image');
      if (params.strength == null) {
        throw new ImageGenError(
          `${provider.name} image-to-image requires strength.`,
          `${providerLogLabel(provider)} missing strength`,
        );
      }
      form.append('strength', String(params.strength));
      form.append('image', new Blob([input.bytes], { type: input.mimeType }), 'input');
    }

    let res: Response;
    try {
      res = await fetchImpl(target.url, {
        method: 'POST',
        headers,
        body: form,
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
      throw new ImageGenError(`${provider.name} returned invalid JSON.`, `${providerLogLabel(provider)} returned invalid JSON`);
    }
    if (!isRecord(json)) {
      throw new ImageGenError(`${provider.name} returned an invalid response.`, `${providerLogLabel(provider)} returned an invalid response`);
    }
    if (typeof json.finish_reason === 'string' && json.finish_reason !== 'SUCCESS') {
      throw new ImageGenError(
        `${provider.name} filtered the generated image. Rephrase the prompt and try again.`,
        `${providerLogLabel(provider)} content filtered`,
      );
    }
    const mimeType = params.outputFormat ? OUTPUT_MIME[params.outputFormat] : undefined;
    const candidate = typeof json.image === 'string'
      ? mimeType ? `data:${mimeType};base64,${json.image}` : json.image
      : undefined;
    const classified = classifyImageOutput(candidate);
    if (!classified) {
      throw new ImageGenError(
        `${provider.name} returned no image data.`,
        `${providerLogLabel(provider)} returned no image data`,
      );
    }
    const requestId = res.headers.get('x-request-id') ?? undefined;
    const usage: Record<string, number> = {};
    if (typeof json.seed === 'number') usage.seed = json.seed;
    return [{
      data: classified,
      ...(requestId || Object.keys(usage).length > 0
        ? { metadata: coreMetadata({ ...(requestId ? { requestId } : {}), ...(Object.keys(usage).length > 0 ? { usage } : {}) }) }
        : {}),
    }];
  },
};
