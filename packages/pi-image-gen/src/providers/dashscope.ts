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
import { classifyImageOutput, MAX_GENERATED_IMAGES, toDataUri } from '../image-input.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';
import { coreMetadata, parseReportedCost, preferredReportedCost } from '../core/usage.js';
import { hasProviderAuthentication, jsonHeaders } from './openai.js';
import {
  providerCallbackFetch,
  providerCallbackHeaders,
  providerCallbackTarget,
  readProviderJson,
} from './provider-callback.js';

/**
 * Alibaba Model Studio image APIs. Qwen, Wan 2.7 and Z-Image share a
 * synchronous multimodal-generation envelope; Wan additionally documents an
 * async task endpoint and a result polling endpoint.
 *   POST /services/aigc/multimodal-generation/generation
 *   POST /services/aigc/image-generation/generation  (X-DashScope-Async: enable)
 *   GET  /tasks/{task_id}
 */

type DashScopeFamily = 'qwen' | 'wan' | 'z-image';

function dashScopeFamily(remoteModelId: string): DashScopeFamily {
  if (/^wan2(?:\.|-)?7-image/i.test(remoteModelId)) return 'wan';
  if (/^z-image/i.test(remoteModelId)) return 'z-image';
  return 'qwen';
}

/** DashScope wants "<width>*<height>" (asterisk), not the "<w>x<h>" tool hint. */
function normalizeDashScopeSize(size: string): string {
  const trimmed = size.trim();
  const match = SIZE_PIXEL_RE.exec(trimmed);
  return match ? `${match[1]}*${match[2]}` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponseError(provider: ResolvedProvider): ImageGenError {
  return new ImageGenError(
    `${provider.name} returned an invalid image response.`,
    `${providerLogLabel(provider)} returned an invalid image response`,
  );
}

async function postJson(
  provider: ResolvedProvider,
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
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
  if (!isRecord(json)) throw invalidResponseError(provider);
  if (typeof json.code === 'string' && json.code) {
    const message = typeof json.message === 'string' ? json.message : 'Provider returned an error.';
    throw new ImageGenError(`${provider.name}: ${message}`, `${providerLogLabel(provider)} ${json.code}`);
  }
  return json;
}

function buildParameters(
  family: DashScopeFamily,
  params: GenerateImageParams,
): Record<string, unknown> {
  if (family === 'z-image') {
    return {
      ...(params.size ? { size: normalizeDashScopeSize(params.size) } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
      ...(params.promptEnhance != null ? { prompt_extend: params.promptEnhance } : {}),
    };
  }
  if (family === 'wan') {
    const sequential = params.sequentialMaxImages != null;
    return {
      n: sequential ? params.sequentialMaxImages : params.n ?? 1,
      ...(sequential ? { enable_sequential: true } : {}),
      ...(params.size ? { size: normalizeDashScopeSize(params.size) } : {}),
      ...(params.watermark != null ? { watermark: params.watermark } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
      ...(!sequential && params.enableThinking != null ? { thinking_mode: params.enableThinking } : {}),
    };
  }
  return {
    n: params.n ?? 1,
    watermark: params.watermark ?? false,
    ...(params.size ? { size: normalizeDashScopeSize(params.size) } : {}),
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    ...(params.seed != null ? { seed: params.seed } : {}),
    ...(params.promptEnhance != null ? { prompt_extend: params.promptEnhance } : {}),
    ...(params.enableThinking != null
      ? { enable_thinking: params.enableThinking }
      : params.promptEnhance === false
        ? { enable_thinking: false }
        : {}),
  };
}

function parseImages(
  provider: ResolvedProvider,
  output: Record<string, unknown>,
): RawImageResult[] {
  const choices = output.choices;
  if (choices !== undefined && !Array.isArray(choices)) throw invalidResponseError(provider);
  const out: RawImageResult[] = [];
  for (const choice of choices ?? []) {
    if (!isRecord(choice)) throw invalidResponseError(provider);
    const message = choice.message;
    if (message !== undefined && !isRecord(message)) throw invalidResponseError(provider);
    const content = isRecord(message) ? message.content : undefined;
    if (content !== undefined && !Array.isArray(content)) throw invalidResponseError(provider);
    for (const part of content ?? []) {
      if (!isRecord(part)) throw invalidResponseError(provider);
      const imageUrl = part.image_url;
      const candidate =
        typeof imageUrl === 'string'
          ? imageUrl
          : isRecord(imageUrl) && typeof imageUrl.url === 'string'
            ? imageUrl.url
            : typeof part.image === 'string'
              ? part.image
              : undefined;
      const classified = classifyImageOutput(candidate);
      if (classified) {
        if (out.length >= MAX_GENERATED_IMAGES) {
          throw new ImageGenError(
            `Provider returned too many images (maximum ${MAX_GENERATED_IMAGES}).`,
            `${providerLogLabel(provider)} returned too many images`,
          );
        }
        out.push({ data: classified });
      }
    }
  }
  return out;
}

function attachMetadata(
  provider: ResolvedProvider,
  out: RawImageResult[],
  json: Record<string, unknown>,
): void {
  const requestId = typeof json.request_id === 'string' ? json.request_id : undefined;
  const usage = isRecord(json.usage) ? json.usage : undefined;
  const reportedCost = preferredReportedCost(
    parseReportedCost(json.cost, json.currency, 'provider-response'),
    parseReportedCost(usage?.cost, usage?.currency, 'provider-response', json.currency),
  );
  if (out[0]) out[0].metadata = coreMetadata({
    ...(requestId ? { requestId } : {}), reportedUsage: usage,
    ...(reportedCost ? { reportedCost } : {}),
  });
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError('DashScope task polling'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledError('DashScope task polling'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollTask(
  provider: ResolvedProvider,
  taskUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  for (;;) {
    await wait(1000, signal);
    const polled = await providerCallbackFetch(provider, taskUrl, {
      method: 'GET',
      headers,
      signal: signal ?? null,
    });
    const json = await readProviderJson(provider, polled.response);
    const output = isRecord(json.output) ? json.output : undefined;
    const status = typeof output?.task_status === 'string' ? output.task_status : undefined;
    if (status === 'SUCCEEDED') return json;
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      const message = typeof json.message === 'string' ? json.message : `Task ${status.toLowerCase()}.`;
      throw new ImageGenError(`${provider.name}: ${message}`, `${providerLogLabel(provider)} task ${status.toLowerCase()}`);
    }
    if (!status) throw invalidResponseError(provider);
  }
}

export const dashscopeAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!hasProviderAuthentication(provider)) {
      throw missingKeyError(provider);
    }
    const base = withDefaultPath(provider.baseUrl, '/api/v1');
    const family = dashScopeFamily(remoteModelId);
    const userContent: Array<{ text?: string; image?: string }> = [];
    for (const input of inputs ?? []) {
      userContent.push({ image: toDataUri(input) });
    }
    userContent.push({ text: params.prompt });
    const requestBody = {
      model: remoteModelId,
      input: { messages: [{ role: 'user', content: userContent }] },
      parameters: buildParameters(family, params),
    };

    let json: Record<string, unknown>;
    if (family === 'wan' && params.asyncMode) {
      const asyncHeaders = { ...jsonHeaders(provider), 'X-DashScope-Async': 'enable' };
      json = await postJson(
        provider,
        fetchImpl,
        `${base}/services/aigc/image-generation/generation`,
        asyncHeaders,
        requestBody,
        signal,
      );
      const output = isRecord(json.output) ? json.output : undefined;
      const taskId = typeof output?.task_id === 'string' ? output.task_id : undefined;
      if (!taskId) throw invalidResponseError(provider);
      const callback = providerCallbackTarget(
        provider,
        `${base}/tasks/${encodeURIComponent(taskId)}`,
      );
      const pollHeaders = providerCallbackHeaders(jsonHeaders(provider), callback.sameOrigin);
      json = await pollTask(
        provider,
        callback.url,
        pollHeaders,
        signal,
      );
    } else {
      json = await postJson(
        provider,
        fetchImpl,
        `${base}/services/aigc/multimodal-generation/generation`,
        jsonHeaders(provider),
        requestBody,
        signal,
      );
    }

    const output = isRecord(json.output) ? json.output : undefined;
    if (!output) throw invalidResponseError(provider);
    const out = parseImages(provider, output);
    attachMetadata(provider, out, json);
    if (out.length === 0) {
      const detail = `${provider.name} returned no images. The model may have refused the prompt or the response shape changed.`;
      throw new ImageGenError(detail, `${providerLogLabel(provider)} returned no images`);
    }
    return out;
  },
};
