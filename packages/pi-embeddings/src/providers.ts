import { getEncoding } from 'js-tiktoken';
import { EmbeddingsError } from './errors.js';
import {
  EMBEDDING_DOCUMENT_PREFIX,
  EMBEDDING_FORMAT_VERSION,
  EMBEDDING_NORMALIZATION_VERSION,
  type EmbeddingContext,
  type EmbeddingDiagnostic,
  type EmbeddingRoute,
  type EmbeddingSettings,
  type EmbeddingSpace,
} from './schemas.js';
import { fixedOrigin, headerValueIsSafe, requestJson } from './provider-http.js';
import { acquireLocalRuntime, LOCAL_EMBEDDING_SPACE, type AcquiredLocalRuntime } from './local-runtime.js';
import type { EmbeddingsProvider, PreparedInput, ProviderBatchResult } from './provider-types.js';
import { parseBatchResponse } from './response.js';

export const OPENAI_EMBEDDING_SPACE: EmbeddingSpace = Object.freeze({
  provider: 'openai',
  model: 'text-embedding-3-small',
  revision: null,
  quantization: null,
  runtime: null,
  dimensions: 1536,
  format: EMBEDDING_FORMAT_VERSION,
  prefix: EMBEDDING_DOCUMENT_PREFIX,
  normalization: EMBEDDING_NORMALIZATION_VERSION,
});

export const SARVAM_EMBEDDING_SPACE: EmbeddingSpace = Object.freeze({
  provider: 'sarvam',
  model: 'embeddinggemma-2',
  revision: null,
  quantization: null,
  runtime: 'sarvam-v2',
  dimensions: 768,
  format: EMBEDDING_FORMAT_VERSION,
  prefix: EMBEDDING_DOCUMENT_PREFIX,
  normalization: EMBEDDING_NORMALIZATION_VERSION,
});

const OPENAI_MODEL = 'text-embedding-3-small';
const SARVAM_MODEL = 'embeddinggemma-2';
const SARVAM_ORIGIN = 'https://api.sarvam.ai';

const OPENAI_MAX_INPUT_TOKENS = 8192;
const OPENAI_MAX_REQUEST_INPUTS = 2048;
const OPENAI_MAX_REQUEST_TOKENS = 300000;

const trim = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

export const routeKey = (route: EmbeddingRoute): string => `${route.provider}\u0000${route.model}`;

/** Diagnostics are provider-free and never contain keys, origins or model paths. */
export function routeDiagnostics(settings: EmbeddingSettings, route: EmbeddingRoute): EmbeddingDiagnostic[] {
  const diagnostics: EmbeddingDiagnostic[] = [];
  const add = (code: string, severity: EmbeddingDiagnostic['severity'] = 'error'): void => {
    diagnostics.push({ code, severity });
  };
  switch (route.provider) {
    case 'local': {
      const local = settings.providers?.local;
      if (trim(local?.executable) === undefined || trim(local?.modelPath) === undefined)
        add('local-assets-unconfigured');
      break;
    }
    case 'openai':
      if (trim(settings.providers?.openai?.apiKey) === undefined && trim(process.env.OPENAI_API_KEY) === undefined)
        add('openai-key-unconfigured');
      break;
    case 'sarvam':
      if (trim(settings.providers?.sarvam?.apiKey) === undefined && trim(process.env.SARVAM_API_KEY) === undefined)
        add('sarvam-key-unconfigured');
      break;
    case 'gateway': {
      const gateway = settings.providers?.gateway;
      if (trim(gateway?.baseUrl) === undefined && trim(process.env.LITELLM_BASE_URL) === undefined)
        add('gateway-base-url-unconfigured');
      if (trim(gateway?.apiKey) === undefined && trim(process.env.LITELLM_INFERENCE_KEY) === undefined)
        add('gateway-key-unconfigured');
      break;
    }
  }
  return diagnostics;
}

const credential = (configured: string | undefined, env: string | undefined): string => {
  const value = trim(configured) ?? trim(env);
  if (value === undefined) throw new EmbeddingsError('missing-credentials');
  return value;
};

/** The documented text-string path avoids the token-array schema contradiction without truncating. */
const openAIPrepare = (
  encoding: ReturnType<typeof getEncoding>,
  text: string,
  signal: AbortSignal
): PreparedInput => {
  signal.throwIfAborted();
  const prepared = EMBEDDING_DOCUMENT_PREFIX + text;
  const tokens = encoding.encode(prepared, [], []);
  if (tokens.length > OPENAI_MAX_INPUT_TOKENS) throw new EmbeddingsError('input-too-long');
  if (encoding.decode(tokens) !== prepared) throw new EmbeddingsError('tokenizer-roundtrip-failed');
  return { kind: 'text', text: prepared, tokenCount: tokens.length };
};

const preparedTokens = (inputs: readonly PreparedInput[]): number =>
  inputs.reduce((sum, input) => sum + (input.kind === 'tokens' ? input.tokens.length : (input.tokenCount ?? 0)), 0);

const providerTexts = (inputs: readonly PreparedInput[]): string[] =>
  inputs.map((input) => {
    if (input.kind !== 'text') throw new EmbeddingsError('provider-response-invalid');
    return input.text;
  });

class OpenAiProvider implements EmbeddingsProvider {
  readonly route = 'openai' as const;
  readonly model = OPENAI_MODEL;
  readonly space: EmbeddingSpace = OPENAI_EMBEDDING_SPACE;
  readonly maxRequestInputs = OPENAI_MAX_REQUEST_INPUTS;
  readonly maxRequestTokens = OPENAI_MAX_REQUEST_TOKENS;
  readonly #encoding = getEncoding('cl100k_base');
  readonly #key: string;

  constructor(key: string) {
    this.#key = key;
  }

  async prepare(text: string, signal: AbortSignal): Promise<PreparedInput> {
    return openAIPrepare(this.#encoding, text, signal);
  }

  async embed(inputs: readonly PreparedInput[], signal: AbortSignal): Promise<ProviderBatchResult> {
    const response = await requestJson({
      url: new URL('https://api.openai.com/v1/embeddings'),
      signal,
      headers: { authorization: `Bearer ${this.#key}` },
      body: {
        model: this.model,
        dimensions: this.space.dimensions,
        input: providerTexts(inputs),
        encoding_format: 'float',
      },
    });
    return parseBatchResponse({
      response,
      space: this.space,
      expectedPreparedTokens: preparedTokens(inputs),
      preparedInputTokens: preparedTokens(inputs),
    });
  }

  async close(): Promise<void> {
    // js-tiktoken is pure JavaScript and owns no process or handle.
  }
}

class SarvamProvider implements EmbeddingsProvider {
  readonly route = 'sarvam' as const;
  readonly model = SARVAM_MODEL;
  readonly space: EmbeddingSpace = SARVAM_EMBEDDING_SPACE;
  // The service enforces its documented per-string token estimate and publishes no aggregate cap.
  readonly maxRequestInputs = Number.POSITIVE_INFINITY;
  readonly maxRequestTokens = Number.POSITIVE_INFINITY;
  readonly #key: string;

  constructor(key: string) {
    this.#key = key;
  }

  async prepare(text: string, signal: AbortSignal): Promise<PreparedInput> {
    signal.throwIfAborted();
    return { kind: 'text', text: EMBEDDING_DOCUMENT_PREFIX + text, tokenCount: null };
  }

  async embed(inputs: readonly PreparedInput[], signal: AbortSignal): Promise<ProviderBatchResult> {
    const response = await requestJson({
      url: new URL('/v2/embeddings', SARVAM_ORIGIN),
      signal,
      headers: { 'api-subscription-key': this.#key },
      body: { model: this.model, input: providerTexts(inputs), encoding_format: 'float' },
    });
    return parseBatchResponse({ response, space: this.space, expectedModels: [this.model] });
  }

  async close(): Promise<void> {
    // Native fetch owns no long-lived resource.
  }
}

type GatewaySettings = NonNullable<NonNullable<EmbeddingSettings['providers']>['gateway']>;

class GatewayProvider implements EmbeddingsProvider {
  readonly route = 'gateway' as const;
  readonly model: string;
  readonly space: EmbeddingSpace = OPENAI_EMBEDDING_SPACE;
  readonly maxRequestInputs = OPENAI_MAX_REQUEST_INPUTS;
  readonly maxRequestTokens = OPENAI_MAX_REQUEST_TOKENS;
  readonly #encoding = getEncoding('cl100k_base');
  readonly #origin: URL;
  readonly #key: string;
  readonly #stage: 'dev' | 'prod';

  constructor(config: GatewaySettings, origin: URL, key: string) {
    this.model = config.model;
    this.#origin = origin;
    this.#key = key;
    this.#stage = config.stage;
  }

  async prepare(text: string, signal: AbortSignal): Promise<PreparedInput> {
    return openAIPrepare(this.#encoding, text, signal);
  }

  async embed(
    inputs: readonly PreparedInput[],
    signal: AbortSignal,
    context: EmbeddingContext | undefined
  ): Promise<ProviderBatchResult> {
    if (
      context === undefined ||
      !headerValueIsSafe(context.endUser) ||
      context.tags.length === 0 ||
      context.tags.some((tag) => !headerValueIsSafe(tag))
    )
      throw new EmbeddingsError('attribution-unavailable');
    const response = await requestJson({
      url: new URL('/v1/embeddings', this.#origin),
      signal,
      headers: {
        authorization: `Bearer ${this.#key}`,
        'x-litellm-customer-id': context.endUser,
        'x-litellm-tags': context.tags.join(','),
      },
      body: {
        model: this.model,
        dimensions: this.space.dimensions,
        input: providerTexts(inputs),
        encoding_format: 'float',
      },
    });
    const count = preparedTokens(inputs);
    return parseBatchResponse({
      response,
      space: this.space,
      expectedModels: [this.space.model, this.model],
      expectedPreparedTokens: count,
      preparedInputTokens: count,
    });
  }

  async close(): Promise<void> {
    // js-tiktoken is pure JavaScript and owns no process or handle.
  }
}

export type AcquiredProvider = Readonly<{
  readonly provider: EmbeddingsProvider;
  readonly release: () => Promise<void>;
}>;

const noRelease = async (): Promise<void> => undefined;

/** Resolve a configured route only when that route is actually about to be used. */
export async function acquireProvider({
  settings,
  route,
  signal,
}: {
  settings: EmbeddingSettings;
  route: EmbeddingRoute;
  signal: AbortSignal;
}): Promise<AcquiredProvider> {
  switch (route.provider) {
    case 'local': {
      const local = settings.providers?.local;
      const executable = trim(local?.executable);
      const modelPath = trim(local?.modelPath);
      if (local === undefined || executable === undefined || modelPath === undefined)
        throw new EmbeddingsError('configuration-invalid');
      const acquired: AcquiredLocalRuntime = await acquireLocalRuntime(
        { executable, modelPath, port: local.port ?? 8791 },
        signal
      );
      return { provider: acquired.provider, release: acquired.release };
    }
    case 'openai':
      return {
        provider: new OpenAiProvider(
          credential(settings.providers?.openai?.apiKey, process.env.OPENAI_API_KEY)
        ),
        release: noRelease,
      };
    case 'sarvam':
      return {
        provider: new SarvamProvider(
          credential(settings.providers?.sarvam?.apiKey, process.env.SARVAM_API_KEY)
        ),
        release: noRelease,
      };
    case 'gateway': {
      const configured = settings.providers?.gateway;
      const baseUrl = trim(configured?.baseUrl) ?? trim(process.env.LITELLM_BASE_URL);
      const key = credential(configured?.apiKey, process.env.LITELLM_INFERENCE_KEY);
      const rawModel = trim(configured?.model) ?? trim(process.env.LITELLM_EMBEDDING_MODEL) ?? OPENAI_MODEL;
      if (
        rawModel !== 'text-embedding-3-small' &&
        rawModel !== 'openai/text-embedding-3-small'
      )
        throw new EmbeddingsError('configuration-invalid');
      const stage = configured?.stage ?? 'dev';
      if (baseUrl === undefined) throw new EmbeddingsError('configuration-invalid');
      const gateway: GatewaySettings = { baseUrl, apiKey: key, model: rawModel, stage };
      return {
        provider: new GatewayProvider(gateway, fixedOrigin(baseUrl), key),
        release: noRelease,
      };
    }
  }
}

export const spaceForRoute = (route: EmbeddingRoute): EmbeddingSpace => {
  switch (route.provider) {
    case 'local':
      return LOCAL_EMBEDDING_SPACE;
    case 'openai':
    case 'gateway':
      return OPENAI_EMBEDDING_SPACE;
    case 'sarvam':
      return SARVAM_EMBEDDING_SPACE;
  }
};
