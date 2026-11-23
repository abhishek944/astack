/**
 * Authoritative public schemas for pi-embeddings.
 *
 * Types across the library, Pi extension and MCP server derive from this file. The descriptor shape
 * deliberately matches the stored HighSKU vector space document, so legacy vectors remain compatible
 * without rewriting stored bytes or inventing unknown provenance.
 */
import { Type, type Static } from 'typebox';

export const EMBEDDINGS_SETTINGS_KEY = 'pi-embeddings';
export const EMBEDDINGS_PROTOCOL_VERSION = 2;
export const EMBEDDING_FORMAT_VERSION = 'host-display-attributes-v1';
export const EMBEDDING_DOCUMENT_PREFIX = 'title: none | text: ';
export const EMBEDDING_NORMALIZATION_VERSION = 'finite-nonzero-l2-v1';
export const EMBEDDING_CONTEXT_META_KEY = 'pi-embeddings/context';

export const EMBEDDING_ROUTE_IDS = [
  'local',
  'openai',
  'sarvam',
  'gateway',
  'openrouter',
  'cloudflare',
] as const;
export type EmbeddingRouteId = (typeof EMBEDDING_ROUTE_IDS)[number];

export const GATEWAY_EMBEDDING_MODELS = [
  'text-embedding-3-small',
  'openai/text-embedding-3-small',
] as const;

export const OPENROUTER_EMBEDDING_MODELS = ['openai/text-embedding-3-small'] as const;
export const CLOUDFLARE_EMBEDDING_MODELS = ['@cf/baai/bge-base-en-v1.5'] as const;

const gatewayModelSchema = Type.Union([
  Type.Literal('text-embedding-3-small'),
  Type.Literal('openai/text-embedding-3-small'),
]);

const openRouterModelSchema = Type.Literal('openai/text-embedding-3-small');
const cloudflareModelSchema = Type.Literal('@cf/baai/bge-base-en-v1.5');

const embeddingErrorCodeSchema = Type.Union([
  Type.Literal('configuration-invalid'),
  Type.Literal('route-unconfigured'),
  Type.Literal('missing-credentials'),
  Type.Literal('http-auth'),
  Type.Literal('http-not-found'),
  Type.Literal('http-rate-limit'),
  Type.Literal('http-forbidden'),
  Type.Literal('http-bad-request'),
  Type.Literal('http-server-error'),
  Type.Literal('transport-failed'),
  Type.Literal('provider-response-invalid'),
  Type.Literal('provider-response-mismatch'),
  Type.Literal('vector-invalid'),
  Type.Literal('vector-zero'),
  Type.Literal('input-empty'),
  Type.Literal('input-too-long'),
  Type.Literal('tokenizer-roundtrip-failed'),
  Type.Literal('attribution-unavailable'),
  Type.Literal('local-resources-unavailable'),
  Type.Literal('local-model-mismatch'),
  Type.Literal('local-runtime-mismatch'),
  Type.Literal('local-startup-failed'),
  Type.Literal('local-cpu-startup-invalid'),
  Type.Literal('cancelled'),
  Type.Literal('unstarted'),
]);

export const EMBEDDING_ERROR_CODES = [
  'configuration-invalid',
  'route-unconfigured',
  'missing-credentials',
  'http-auth',
  'http-not-found',
  'http-rate-limit',
  'http-forbidden',
  'http-bad-request',
  'http-server-error',
  'transport-failed',
  'provider-response-invalid',
  'provider-response-mismatch',
  'vector-invalid',
  'vector-zero',
  'input-empty',
  'input-too-long',
  'tokenizer-roundtrip-failed',
  'attribution-unavailable',
  'local-resources-unavailable',
  'local-model-mismatch',
  'local-runtime-mismatch',
  'local-startup-failed',
  'local-cpu-startup-invalid',
  'cancelled',
  'unstarted',
] as const;
export type EmbeddingErrorCode = (typeof EMBEDDING_ERROR_CODES)[number];

const embeddingProviderSchema = Type.Union([
  Type.Literal('local'),
  Type.Literal('openai'),
  Type.Literal('sarvam'),
  Type.Literal('gateway'),
  Type.Literal('openrouter'),
  Type.Literal('cloudflare'),
]);

export const embeddingRouteSchema = Type.Object(
  {
    provider: embeddingProviderSchema,
    model: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false }
);

const spaceCommon = {
  format: Type.Literal(EMBEDDING_FORMAT_VERSION),
  prefix: Type.Literal(EMBEDDING_DOCUMENT_PREFIX),
  normalization: Type.Literal(EMBEDDING_NORMALIZATION_VERSION),
};

/**
 * Complete generating-space identity. `provider` is canonical: the gateway route deliberately
 * reports the OpenAI recipe it declares, not its transport alias.
 */
export const embeddingSpaceSchema = Type.Union([
  Type.Object(
    {
      ...spaceCommon,
      provider: Type.Literal('local'),
      model: Type.Literal('embeddinggemma-2'),
      revision: Type.String({ minLength: 1 }),
      quantization: Type.Literal('Q8_0'),
      runtime: Type.String({ minLength: 1 }),
      dimensions: Type.Literal(768),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      ...spaceCommon,
      provider: Type.Literal('openai'),
      model: Type.Literal('text-embedding-3-small'),
      revision: Type.Null(),
      quantization: Type.Null(),
      runtime: Type.Null(),
      dimensions: Type.Literal(1536),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      ...spaceCommon,
      provider: Type.Literal('sarvam'),
      model: Type.Literal('embeddinggemma-2'),
      revision: Type.Null(),
      quantization: Type.Null(),
      runtime: Type.Literal('sarvam-v2'),
      dimensions: Type.Literal(768),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      ...spaceCommon,
      provider: Type.Literal('cloudflare'),
      model: cloudflareModelSchema,
      revision: Type.Null(),
      quantization: Type.Null(),
      runtime: Type.Literal('cloudflare-workers-ai'),
      dimensions: Type.Literal(768),
      pooling: Type.Union([Type.Literal('mean'), Type.Literal('cls')]),
    },
    { additionalProperties: false }
  ),
]);

export const embeddingSettingsSchema = Type.Object(
  {
    version: Type.Optional(Type.Literal(1)),
    default: embeddingRouteSchema,
    fallback: Type.Optional(Type.Array(embeddingRouteSchema)),
    compare: Type.Optional(Type.Array(embeddingRouteSchema)),
    providers: Type.Optional(
      Type.Object(
        {
          local: Type.Optional(
            Type.Object(
              {
                executable: Type.String({ minLength: 1 }),
                modelPath: Type.String({ minLength: 1 }),
                port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
              },
              { additionalProperties: false }
            )
          ),
          openai: Type.Optional(
            Type.Object(
              { apiKey: Type.Optional(Type.String({ minLength: 1 })) },
              { additionalProperties: false }
            )
          ),
          sarvam: Type.Optional(
            Type.Object(
              { apiKey: Type.Optional(Type.String({ minLength: 1 })) },
              { additionalProperties: false }
            )
          ),
          gateway: Type.Optional(
            Type.Object(
              {
                baseUrl: Type.String({ minLength: 1 }),
                apiKey: Type.String({ minLength: 1 }),
                model: gatewayModelSchema,
                stage: Type.Union([Type.Literal('dev'), Type.Literal('prod')]),
              },
              { additionalProperties: false }
            )
          ),
          openrouter: Type.Optional(
            Type.Object(
              { apiKey: Type.Optional(Type.String({ minLength: 1 })) },
              { additionalProperties: false }
            )
          ),
          cloudflare: Type.Optional(
            Type.Object(
              {
                accountId: Type.Optional(Type.String({ minLength: 1 })),
                apiKey: Type.Optional(Type.String({ minLength: 1 })),
                gatewayId: Type.Optional(Type.String({ minLength: 1 })),
                model: Type.Optional(cloudflareModelSchema),
                pooling: Type.Optional(
                  Type.Union([Type.Literal('mean'), Type.Literal('cls')])
                ),
              },
              { additionalProperties: false }
            )
          ),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);

export const embeddingRequestSchema = Type.Object(
  {
    inputs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false }
);

/** Generic, host-owned attribution. It is never a model argument or proof of ownership. */
export const embeddingContextSchema = Type.Object(
  {
    endUser: Type.String({ minLength: 1 }),
    tags: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false }
);

export const embeddingUsageSchema = Type.Object(
  {
    providerReportedInputTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    preparedInputTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    billedTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false }
);

export const embeddingAttemptSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    route: embeddingProviderSchema,
    model: Type.String({ minLength: 1 }),
    routeIndex: Type.Integer({ minimum: 0 }),
    status: Type.Union([Type.Literal('success'), Type.Literal('error'), Type.Literal('cancelled')]),
    usage: Type.Union([embeddingUsageSchema, Type.Null()]),
    errorCode: Type.Optional(embeddingErrorCodeSchema),
  },
  { additionalProperties: false }
);

const successOutcomeSchema = Type.Object(
  {
    status: Type.Literal('success'),
    index: Type.Integer({ minimum: 0 }),
    vector: Type.Array(Type.Number()),
    route: embeddingProviderSchema,
    model: Type.String({ minLength: 1 }),
    space: embeddingSpaceSchema,
    attemptId: Type.String({ minLength: 1 }),
    normalization: Type.Literal(EMBEDDING_NORMALIZATION_VERSION),
  },
  { additionalProperties: false }
);

const errorOutcomeSchema = Type.Object(
  {
    status: Type.Literal('error'),
    index: Type.Integer({ minimum: 0 }),
    code: embeddingErrorCodeSchema,
    attemptId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false }
);

export const embeddingOutcomeSchema = Type.Union([successOutcomeSchema, errorOutcomeSchema]);

/**
 * Actual generating identity observed on successful outcomes. `generations` is the complete set;
 * the singular fields are populated only when every successful vector came from one generation.
 */
export const embeddingGenerationSchema = Type.Object(
  {
    provider: embeddingProviderSchema,
    model: Type.String({ minLength: 1 }),
    space: embeddingSpaceSchema,
  },
  { additionalProperties: false }
);

export const embeddingResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(EMBEDDINGS_PROTOCOL_VERSION),
    provider: Type.Union([embeddingProviderSchema, Type.Null()]),
    model: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    space: Type.Union([embeddingSpaceSchema, Type.Null()]),
    generations: Type.Array(embeddingGenerationSchema),
    outcomes: Type.Array(embeddingOutcomeSchema),
    attempts: Type.Array(embeddingAttemptSchema),
  },
  { additionalProperties: false }
);

export const embeddingCompareEntrySchema = Type.Object(
  {
    route: embeddingProviderSchema,
    model: Type.String({ minLength: 1 }),
    status: Type.Union([Type.Literal('success'), Type.Literal('error'), Type.Literal('cancelled')]),
    result: embeddingResultSchema,
  },
  { additionalProperties: false }
);

export const embeddingCompareResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(EMBEDDINGS_PROTOCOL_VERSION),
    entries: Type.Array(embeddingCompareEntrySchema),
  },
  { additionalProperties: false }
);

export type EmbeddingSettings = Static<typeof embeddingSettingsSchema>;
export type EmbeddingRoute = Static<typeof embeddingRouteSchema>;
export type EmbeddingSpace = Static<typeof embeddingSpaceSchema>;
export type EmbeddingRequest = Static<typeof embeddingRequestSchema>;
export type EmbeddingContext = Static<typeof embeddingContextSchema>;
export type EmbeddingUsage = Static<typeof embeddingUsageSchema>;
export type EmbeddingAttempt = Static<typeof embeddingAttemptSchema>;
export type EmbeddingOutcome = Static<typeof embeddingOutcomeSchema>;
export type EmbeddingGeneration = Static<typeof embeddingGenerationSchema>;
export type EmbeddingResult = Static<typeof embeddingResultSchema>;
export type EmbeddingCompareEntry = Static<typeof embeddingCompareEntrySchema>;
export type EmbeddingCompareResult = Static<typeof embeddingCompareResultSchema>;
