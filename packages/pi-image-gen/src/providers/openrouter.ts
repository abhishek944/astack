import { describeNetworkError, missingKeyError } from '../errors.js';
import { toDataUri } from '../image-input.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';
import { credentialRedirectMode, hasProviderAuthentication, jsonHeaders, parseImagesResponse } from './openai.js';

/**
 * OpenRouter image API. Looks OpenAI-shaped but the endpoint differs:
 *   - OpenAI:     POST /v1/images/generations  (text)  /  /v1/images/edits (multipart)
 *   - OpenRouter: POST /api/v1/images          (text)  /  same path + `input_references` JSON (edits)
 *
 * Since the 2026-11-19 schema change, `data[].b64_json` is optional and
 * `data[].url` plus top-level `expires_at` are valid with `response_format: url`.
 * The shared parser accepts both forms and records a validated expiry.
 * See https://openrouter.ai/docs/guides/overview/multimodal/image-generation.
 */
export const openrouterAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!hasProviderAuthentication(provider)) throw missingKeyError(provider);
    const base = withDefaultPath(provider.baseUrl, '/api/v1');
    const url = `${base}/images`;
    const body: Record<string, unknown> = {
      model: remoteModelId,
      prompt: params.prompt,
      n: params.n ?? 1,
    };
    if (params.size) body.size = params.size;
    // Built-in OpenRouter explicitly requests the documented default so delivery
    // never depends on an account-level change. Custom gateways keep their old
    // wire shape unless the caller asks for a response format explicitly.
    if (params.responseFormat) body.response_format = params.responseFormat;
    else if (provider.builtIn && provider.id === 'openrouter') body.response_format = 'b64_json';
    if (params.quality) body.quality = params.quality;
    if (params.outputFormat) body.output_format = params.outputFormat;
    if (params.background) body.background = params.background;
    if (params.outputCompression != null) body.output_compression = params.outputCompression;
    if (params.seed != null) body.seed = params.seed;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (inputs && inputs.length > 0) {
      body.input_references = inputs.map((input) => ({
        type: 'image_url',
        image_url: { url: toDataUri(input) },
      }));
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
  },
};
