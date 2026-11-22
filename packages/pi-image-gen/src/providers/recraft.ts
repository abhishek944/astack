import {
  describeNetworkError,
  ImageGenError,
  missingKeyError,
  providerLogLabel,
  readBodyText,
  throwHttpError,
} from '../errors.js';
import { classifyImageOutput, toDataUri } from '../image-input.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  ImageProviderRuntime,
  RawImageResult,
  RecraftOperation,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';
import { coreMetadata } from '../core/usage.js';
import { bearerHeaders, hasProviderAuthentication } from './openai.js';

/**
 * Recraft dedicated REST API. Generation, editing and processing endpoints all
 * accept JSON with URL or data-URL inputs and return temporary URLs, inline
 * base64, or a single `image` object for processing tools.
 * https://www.recraft.ai/docs/api-reference/agents.md
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function referenceValue(input: ResolvedImageInput): string {
  return input.sourceUrl ?? toDataUri(input);
}

function controls(params: GenerateImageParams): Record<string, unknown> | undefined {
  const value: Record<string, unknown> = {};
  if (params.colorControls?.length) value.colors = params.colorControls;
  if (params.backgroundColor) value.background_color = params.backgroundColor;
  return Object.keys(value).length > 0 ? value : undefined;
}

function recraftSize(params: GenerateImageParams): string | undefined {
  // Vector models expose aspectRatio; the Recraft wire field for both
  // ratio tokens and exact sizes is `size`.
  return params.aspectRatio ?? params.size;
}

function sharedFields(params: GenerateImageParams): Record<string, unknown> {
  const control = controls(params);
  return {
    ...(params.n != null ? { n: params.n } : {}),
    ...(params.seed != null ? { random_seed: params.seed } : {}),
    ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    ...(control ? { controls: control } : {}),
    ...(params.styleId ? { style_id: params.styleId } : {}),
    ...(params.styleReferenceUrls?.length ? { style_reference_urls: params.styleReferenceUrls } : {}),
    ...(params.styleMatch ? { style_match: params.styleMatch } : {}),
    ...(params.textLayout?.length ? { text_layout: params.textLayout } : {}),
  };
}

function resolveOperation(
  params: GenerateImageParams,
  inputs: ResolvedImageInput[],
  mask?: ResolvedImageInput,
): RecraftOperation {
  if (params.operation) return params.operation;
  if (mask) return 'inpaint';
  if (inputs.length > 0) return 'imageToImage';
  return 'generate';
}

const ENDPOINTS: Record<RecraftOperation, string> = {
  generate: '/images/generations',
  imageToImage: '/images/imageToImage',
  inpaint: '/images/inpaint',
  outpaint: '/images/outpaint',
  replaceBackground: '/images/replaceBackground',
  generateBackground: '/images/generateBackground',
  vectorize: '/images/vectorize',
  variateImage: '/images/variateImage',
  removeBackground: '/images/removeBackground',
  crispUpscale: '/images/crispUpscale',
  creativeUpscale: '/images/creativeUpscale',
  enhance: '/images/enhance',
  eraseRegion: '/images/eraseRegion',
};

const MODELLED_OPERATIONS = new Set<RecraftOperation>([
  'generate',
  'imageToImage',
  'inpaint',
  'outpaint',
  'replaceBackground',
  'generateBackground',
  'variateImage',
]);

function buildBody(
  operation: RecraftOperation,
  remoteModelId: string,
  params: GenerateImageParams,
  inputs: ResolvedImageInput[],
  mask?: ResolvedImageInput,
): Record<string, unknown> {
  const imageUrl = inputs[0] ? referenceValue(inputs[0]) : undefined;
  const maskUrl = mask ? toDataUri(mask) : undefined;
  const base: Record<string, unknown> = {};
  if (MODELLED_OPERATIONS.has(operation)) base.model = remoteModelId;
  if (operation === 'generate' && params.outputFormat !== 'svg') {
    base.image_format = params.outputFormat ?? 'webp';
  }
  if (operation !== 'generate' && operation !== 'variateImage' && params.outputFormat && params.outputFormat !== 'svg') {
    base.image_format = params.outputFormat;
  }
  if (operation === 'generate') {
    const size = recraftSize(params);
    return { prompt: params.prompt, ...(size ? { size } : {}), ...base, ...sharedFields(params) };
  }
  if (operation === 'imageToImage') {
    return {
      image_url: imageUrl,
      prompt: params.prompt,
      ...(params.strength != null ? { strength: params.strength } : { strength: 0.7 }),
      ...base,
      ...sharedFields(params),
    };
  }
  if (operation === 'inpaint' || operation === 'generateBackground' || operation === 'eraseRegion') {
    return {
      image_url: imageUrl,
      ...(maskUrl ? { mask_url: maskUrl } : {}),
      ...(operation === 'eraseRegion' ? {} : { prompt: params.prompt }),
      ...base,
      ...sharedFields(params),
    };
  }
  if (operation === 'outpaint') {
    const size = recraftSize(params);
    return {
      image_url: imageUrl,
      prompt: params.prompt,
      ...(size ? { size } : {}),
      ...base,
      ...sharedFields(params),
    };
  }
  if (operation === 'replaceBackground') {
    return { image_url: imageUrl, prompt: params.prompt, ...base, ...sharedFields(params) };
  }
  if (operation === 'variateImage') {
    const size = recraftSize(params);
    return {
      image_url: imageUrl,
      ...(size ? { size } : {}),
      ...base,
      ...(params.n != null ? { n: params.n } : {}),
      ...(params.seed != null ? { random_seed: params.seed } : {}),
      ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
      ...(params.outputFormat && params.outputFormat !== 'svg' ? { image_format: params.outputFormat } : {}),
    };
  }
  return {
    image_url: imageUrl,
    ...base,
    ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
    ...(params.outputFormat && params.outputFormat !== 'svg' ? { image_format: params.outputFormat } : {}),
  };
}

function parseOutputs(
  provider: ResolvedProvider,
  json: Record<string, unknown>,
  params: GenerateImageParams,
): RawImageResult[] {
  const entries: unknown[] = Array.isArray(json.data)
    ? json.data
    : isRecord(json.image) ? [json.image] : [];
  const out: RawImageResult[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const b64 = typeof entry.b64_json === 'string' ? entry.b64_json : undefined;
    const candidate = b64
      ? `data:${params.outputFormat === 'svg' ? 'image/svg+xml' : 'image/webp'};base64,${b64}`
      : typeof entry.url === 'string'
        ? entry.url
        : undefined;
    const classified = classifyImageOutput(candidate);
    if (classified) out.push({ data: classified });
  }
  if (out.length === 0) {
    throw new ImageGenError(
      `${provider.name} returned no image data.`,
      `${providerLogLabel(provider)} returned no image data`,
    );
  }
  const requestId = typeof json.created === 'number' ? String(json.created) : undefined;
  const usage: Record<string, number> = {};
  if (typeof json.credits === 'number') usage.credits = json.credits;
  if (requestId || Object.keys(usage).length > 0) {
    out[0]!.metadata = coreMetadata({
      ...(requestId ? { requestId } : {}),
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    });
  }
  return out;
}

export const recraftAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
    runtime?: ImageProviderRuntime,
  ): Promise<RawImageResult[]> {
    if (!hasProviderAuthentication(provider)) throw missingKeyError(provider);
    const base = withDefaultPath(provider.baseUrl, '/v1');
    const operation = resolveOperation(params, inputs ?? [], runtime?.mask);
    const body = buildBody(operation, remoteModelId, params, inputs ?? [], runtime?.mask);
    const url = `${base}${ENDPOINTS[operation]}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          ...bearerHeaders(provider),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
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
    return parseOutputs(provider, json, params);
  },
};
