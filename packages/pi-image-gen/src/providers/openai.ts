import {
  describeNetworkError,
  missingKeyError,
} from '../errors.js';
import { bearerHeaders, credentialRedirectMode, hasProviderAuthentication, jsonHeaders } from './openai-auth.js';
import { parseImagesResponse } from './openai-parse.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
  ImageProviderRuntime,
} from '../types.js';
import { withDefaultPath } from '../url.js';
import { configureAzureOpenAiProvider, openAiImageUrl } from './azure-openai.js';

export { hasProviderAuthentication, credentialRedirectMode, setHeaderCaseInsensitive, bearerHeaders, jsonHeaders } from './openai-auth.js';
export { parseImagesResponse } from './openai-parse.js';

/**
 * OpenAI-compatible image API. Used for OpenAI directly and any
 * customProvider with `api: 'openai'`.
 *
 * Two endpoints:
 *   - POST /v1/images/generations  (text-to-image, JSON body)
 *   - POST /v1/images/edits        (image-to-image, multipart/form-data)
 *
 * The edit path is selected when the caller passes `inputs` (resolved
 * reference images). Verified GPT Image routes may also attach a separate mask.
 *
 * OpenRouter is NOT OpenAI-compatible for images — it uses POST /api/v1/images
 * (no `/generations` suffix). See providers/openrouter.ts.
 */
export const openaiAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
    runtime?: ImageProviderRuntime,
  ): Promise<RawImageResult[]> {
    if (provider.builtIn && provider.id === 'azure-openai') {
      provider = configureAzureOpenAiProvider(provider);
    }
    if (!hasProviderAuthentication(provider)) {
      throw missingKeyError(provider);
    }
    const base = withDefaultPath(provider.baseUrl, '/v1');
    if (inputs && inputs.length > 0) {
      return generateWithImages(provider, base, remoteModelId, params, inputs, fetchImpl, signal, runtime);
    }
    return generateFromText(provider, base, remoteModelId, params, fetchImpl, signal);
  },
};

async function generateFromText(
  provider: ResolvedProvider,
  base: string,
  remoteModelId: string,
  params: GenerateImageParams,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<RawImageResult[]> {
  const url = openAiImageUrl(provider, base, 'generations');
  const body: Record<string, unknown> = {
    model: remoteModelId,
    prompt: params.prompt,
    n: params.n ?? 1,
  };
  if (params.size) body.size = params.size;
  if (params.quality) body.quality = params.quality;
  if (params.complexity) body.complexity = params.complexity;
  if (params.outputFormat) body.output_format = params.outputFormat;
  if (params.background) body.background = params.background;
  if (params.outputCompression != null) body.output_compression = params.outputCompression;
  // Frame controls and the SVG author object are generation-only. Validation
  // rejects them on the edit path, so this branch can rely on outputFormat.
  if (params.outputFormat === 'gif') {
    if (params.frameCount != null) body.frame_count = params.frameCount;
    if (params.frameDurationMs != null) body.frame_duration_ms = params.frameDurationMs;
  }
  if (params.svgModel) {
    body.svg = {
      model: params.svgModel,
      ...(params.svgReasoningEffort ? { reasoning: { effort: params.svgReasoningEffort } } : {}),
    };
  }

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
  return parseImagesResponse(res, url, provider);
}

async function generateWithImages(
  provider: ResolvedProvider,
  base: string,
  remoteModelId: string,
  params: GenerateImageParams,
  inputs: ResolvedImageInput[],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  runtime?: ImageProviderRuntime,
): Promise<RawImageResult[]> {
  const url = openAiImageUrl(provider, base, 'edits');
  const form = new FormData();
  const mask = runtime?.mask;
  const markup = runtime?.markup;
  form.append('model', remoteModelId);
  form.append('prompt', params.prompt);
  form.append('n', String(params.n ?? 1));
  if (params.size) form.append('size', params.size);
  if (params.quality) form.append('quality', params.quality);
  if (params.complexity) form.append('complexity', params.complexity);
  if (params.outputFormat) form.append('output_format', params.outputFormat);
  if (params.background) form.append('background', params.background);
  if (params.outputCompression != null) form.append('output_compression', String(params.outputCompression));
  if (mask) {
    const ext = mask.mimeType.split('/')[1] ?? 'png';
    form.append('mask', new Blob([new Uint8Array(mask.bytes)], { type: mask.mimeType }), `mask.${ext}`);
  }
  if (markup) {
    const ext = markup.mimeType.split('/')[1] ?? 'png';
    form.append('markup', new Blob([new Uint8Array(markup.bytes)], { type: markup.mimeType }), `markup.${ext}`);
  }
  // OpenAI accepts repeated `image[]` for multi-image edits on gpt-image-2.
  const fieldName = inputs.length > 1 ? 'image[]' : 'image';
  for (const [i, input] of inputs.entries()) {
    const ext = input.mimeType.split('/')[1] ?? 'png';
    const blob = new Blob([new Uint8Array(input.bytes)], { type: input.mimeType });
    form.append(fieldName, blob, `image-${i}.${ext}`);
  }

  const headers = bearerHeaders(provider);
  // fetch must supply the multipart boundary, including when custom headers
  // were configured for JSON generation on this same provider.
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'content-type') delete headers[name];
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: form,
      signal: signal ?? null,
      redirect: credentialRedirectMode(provider),
    });
  } catch (error) {
    throw describeNetworkError(error, provider);
  }
  return parseImagesResponse(res, url, provider);
}
