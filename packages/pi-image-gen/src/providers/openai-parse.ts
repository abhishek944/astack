import { ImageGenError, providerLogLabel, readBodyText, redactUrl, throwHttpError } from '../errors.js';
import { classifyImageOutput, MAX_BASE64_IMAGE_CHARS, MAX_GENERATED_IMAGES, sniffOutputMime } from '../image-input.js';
import { decodeBase64 } from '../core/base64.js';
import { ProviderResultError } from '../core/provider-result.js';
import { coreMetadata, parseReportedCost, preferredReportedCost } from '../core/usage.js';
import type { RawGenerationMetadata, RawImageResult, ResolvedProvider } from '../types/provider.js';

/** Normalize safe request accounting before evaluating whether any image is usable. */
export async function parseImagesResponse(
  res: Response,
  url: string,
  provider: ResolvedProvider,
  options: { maxImages?: number } = {},
): Promise<RawImageResult[]> {
  let metadata: RawGenerationMetadata = {};
  try {
    const requestId = res.headers.get('x-request-id') ?? res.headers.get('request-id') ?? undefined;
    metadata = coreMetadata({ ...(requestId ? { requestId } : {}) });
    if (!res.ok) await throwHttpError(res, provider);
    const text = await readBodyText(res, provider);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      // No raw body, signed endpoint query or untrusted parse-error text reaches the error.
      throw new ImageGenError(
        `${provider.name} returned ${contentType || 'non-JSON'} from ${redactUrl(url)}. The endpoint probably doesn't expose the OpenAI-compatible images API at this path.`,
        `${providerLogLabel(provider)} returned non-JSON`,
      );
    }
    let json: unknown;
    try { json = JSON.parse(text); }
    catch {
      throw new ImageGenError(`${provider.name} returned invalid JSON.`, `${providerLogLabel(provider)} returned invalid JSON`);
    }
    if (!isRecord(json)) throw invalidResponseError(provider);
    // OpenRouter added a top-level signed-URL expiry in 2026-11. Keep only a
    // validated Unix timestamp; no response text or URL reaches metadata here.
    const expiresAt =
      typeof json.expires_at === 'number' &&
      Number.isSafeInteger(json.expires_at) &&
      json.expires_at >= 0
        ? json.expires_at : undefined;
    const usage = isRecord(json.usage) ? json.usage : undefined;
    // SVG author tokens are reported separately from image rendering usage. Keep them
    // nested under svg_usage so image-token normalization and costing never double count them.
    const svgUsage = isRecord(json.svg_usage) ? json.svg_usage : undefined;
    const reportedUsage = usage || svgUsage
      ? { ...(usage ?? {}), ...(svgUsage ? { svg_usage: svgUsage } : {}) }
      : undefined;
    const reportedCost = preferredReportedCost(
      parseReportedCost(json.cost, json.currency, 'provider-response'),
      parseReportedCost(usage?.cost, usage?.currency, 'provider-response', json.currency),
    );
    metadata = coreMetadata({
      ...(requestId ? { requestId } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(reportedUsage ? { reportedUsage } : {}),
      ...(reportedCost ? { reportedCost } : {}),
      ...(reportedCost?.basis === 'provider-response' ? { cost: reportedCost.amount } : {}),
    });
    return imageEntries(json, provider, metadata, options.maxImages ?? MAX_GENERATED_IMAGES);
  } catch (error) {
    const safe = error instanceof ImageGenError ? error : invalidResponseError(provider);
    throw new ProviderResultError(safe, metadata);
  }
}

function imageEntries(
  json: Record<string, unknown>,
  provider: ResolvedProvider,
  metadata: RawGenerationMetadata,
  maxImages: number,
): RawImageResult[] {
  if (json.data !== undefined && !Array.isArray(json.data)) throw invalidResponseError(provider);
  const data = (json.data ?? []) as unknown[];
  if (data.length > maxImages) {
    throw new ImageGenError(
      `Provider returned too many images (maximum ${maxImages}).`,
      `${providerLogLabel(provider)} returned too many images`,
    );
  }
  const out: RawImageResult[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) throw invalidResponseError(provider);
    let payload: RawImageResult['data'] | null = null;
    if (typeof entry.b64_json === 'string' && entry.b64_json) {
      if (entry.b64_json.length > MAX_BASE64_IMAGE_CHARS) {
        throw new ImageGenError('Provider returned an image that exceeds the size ceiling.',
          `${providerLogLabel(provider)} returned an oversized image`);
      }
      const prefix = decodeBase64(entry.b64_json.slice(0, 1536));
      const mimeType = sniffOutputMime(prefix)
        ?? (typeof entry.media_type === 'string' ? entry.media_type : undefined) ?? 'image/png';
      payload = { kind: 'base64', bytes: entry.b64_json, mimeType };
    } else {
      payload = classifyImageOutput(typeof entry.url === 'string' ? entry.url : undefined);
    }
    if (!payload) continue;
    const item: RawImageResult = { data: payload };
    if (typeof entry.revised_prompt === 'string') item.revisedPrompt = entry.revised_prompt;
    out.push(item);
  }
  if (!out.length) {
    throw new ImageGenError(
      `${provider.name} returned no usable images. Response had ${data.length} entries but none had b64_json or a valid url.`,
      `${providerLogLabel(provider)} returned no usable images`,
    );
  }
  if (Object.keys(metadata).length) out[0]!.metadata = metadata;
  return out;
}

function invalidResponseError(provider: ResolvedProvider): ImageGenError {
  return new ImageGenError(`${provider.name} returned an invalid image response.`,
    `${providerLogLabel(provider)} returned an invalid image response`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
