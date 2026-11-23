export type ApiStyle =
  | "openai-decisions"
  | "openrouter-decisions"
  | "gemini-decisions"
  | "inception-decisions"
  | "parallel-decisions"
  | "local-system-one"
  | "perplexity-decisions"
  | "sarvam-system-one"
  | "system-one"
  | "liquid-system-one"
  | "cloudflare-system-one"
  | "cloudflare-clairic"
  | "openrouter-extractions"
  | "litellm-extraction"
  | "microsoft-system-one";

/** Explicit references are resolved only from the request's named images. */
export type ImageReference = { $image: string };
export type QuestionContent = string | (string | ImageReference)[];
export type ImageInput =
  | string
  | { id: string; path: string }
  | { id: string; url: string };

export type MediaInput = { type: "audio" | "video"; path: string };
export type CharSpan = [number, number];
export type BoxEdges = { top: number; bottom: number; left: number; right: number };

export type Question =
  | {
      type: "bool";
      instructions: QuestionContent;
      criteria?: { true?: QuestionContent; false?: QuestionContent };
    }
  | { type: "choice"; instructions: QuestionContent; criteria: Record<string, QuestionContent>; booleanValues?: boolean }
  | { type: "score"; instructions: QuestionContent; criteria: QuestionContent[]; descriptions?: string[] }
  | { type: "extract"; instructions?: QuestionContent; criteria: Record<string, QuestionContent>; source?: string; threshold?: number; snapToWords?: boolean; debug?: boolean }
  | { type: "box"; instructions: QuestionContent }
  | { type: "locate"; instructions: QuestionContent }
  | { type: "text"; instructions: QuestionContent }
  | { type: "number"; instructions: QuestionContent; unit?: string; range?: CharSpan; step?: number }
  | { type: "date"; instructions: QuestionContent }
  | { type: "spans"; instructions: QuestionContent; max?: number }
  | { type: "boxes"; instructions: QuestionContent; max?: number }
  | { type: "estimate"; instructions: QuestionContent; range: CharSpan; step?: number; unit?: string }
  | { type: "multi_choice"; instructions: QuestionContent; criteria: Record<string, QuestionContent> };

export type TextSpan = {
  start: number;
  end: number;
  text: string;
  score: number;
  /** Index into webGrounding.searchResults when the span came from search evidence. */
  searchResult?: number;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  lastUpdated?: string;
};

export type WebFetchedResult = {
  title: string;
  url: string;
  snippet: string;
};

export type DecisionCitation = {
  url: string;
  title?: string;
  excerpts?: string[];
};

export type NonTokenCost = {
  currency: "USD";
  webGrounding: {
    status: "estimated_maximum";
    /** One search is requested per question; duplicate queries and failed searches may not be billed. */
    searchesRequested: number;
    searchFeeMaximum: number;
    /** A successful URL fetch is reported by the provider and is billable. */
    successfulFetches: number;
    fetchFee: number;
    totalMaximum: number;
    note: string;
  };
};

export type ProviderCost = {
  currency: "USD";
  total: number;
  source: "provider" | "gateway";
  note?: string;
};

export type Answer =
  | { type: "bool"; probability: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
      /** Present when probabilities cover one internally processed batch, not the full list. */
      probabilityScope?: "batch";
      noneOfAboveProbability?: number;
    }
  | {
      type: "score";
      score: number;
      confidence: number;
      probabilities?: Record<string, number>;
    }
  | {
      type: "box";
      box: BoxEdges;
      confidence: number;
      found?: number;
    }
  | { type: "locate"; spans: TextSpan[] }
  | { type: "extract"; spans: Record<string, TextSpan[]>; notStated: Record<string, number> }
  | { type: "text"; text: string; span?: CharSpan | null; found?: number; path?: string }
  | { type: "number"; value: number | null; unit?: string | null; text?: string | null; span?: CharSpan | null; found?: number; path?: string }
  | { type: "date"; date: string | null; text?: string | null; span?: CharSpan | null; found?: number; path?: string }
  | {
      type: "spans";
      spans: { text: string; span: CharSpan; found: number }[];
      count: number;
      atLeast: boolean;
      presence: number[];
    }
  | {
      type: "boxes";
      boxes: { box: BoxEdges; found: number; confidence: number }[];
      count: number;
      atLeast: boolean;
      presence: number[];
    }
  | { type: "estimate"; value: number; interval: CharSpan; unit?: string | null }
  | { type: "multi_choice"; choices: string[]; probabilities: Record<string, number> }
  | { type: "refusal" }
  | { type: "no_match" }
  | { type: "ambiguous" };

export interface ClassifyParams {
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, Question>;
  /** Legacy paths are shared in order. Named images require explicit {$image:id} references. */
  images?: ImageInput[];
  /** Shared audio/video inputs for providers that document media support. */
  media?: MediaInput[];
  /** OpenAI Decisions input items: messages, function calls/outputs and custom tool calls/outputs. */
  conversation?: unknown[];
  /** Explicit opt-in to Perplexity web search and page fetching. This can upload state text and incur per-search fees. */
  mode?: "web_grounding";
  /** Image detail hint for adapters that publish one; ignored by routes without a documented field. */
  imageDetail?: "auto" | "low" | "high" | "original";
  /** OpenAI-compatible prompt-cache controls; rejected by routes without a documented contract. */
  promptCache?: {
    key?: string;
    mode?: "implicit" | "explicit";
    ttl?: "30m";
    breakpoints?: boolean;
  };
}

export type ClassificationTreeNode = {
  id: string;
  description?: string;
  children?: ClassificationTreeNode[];
};

export type ClassificationTree = { roots: ClassificationTreeNode[] };

export type ClassifyTreeParams = {
  state: ClassifyParams["state"];
  tree: string | ClassificationTree;
  instructions?: string;
  images?: ImageInput[];
};

export type TreeStep = {
  level: number;
  id: string;
  source: "automatic" | "model";
  confidence?: number;
  probabilityScope?: "siblings" | "batch";
  noneOfAboveProbability?: number;
};

export type ClassifierTreeResult = {
  provider: string;
  model: string;
  status: "complete" | "no_match" | "ambiguous" | "refusal";
  levels: Record<string, string>;
  steps: TreeStep[];
  providerCalls: number;
  cost: ClassifierCost;
  usage?: NonNullable<ClassifierResult["usage"]>;
  attemptedRoutes?: ClassifierRoute[];
};

export interface ModelDefinition {
  id: string;
  name?: string;
  input?: ("text" | "image" | "audio" | "video")[];
  box?: boolean;
}

/** USD per million tokens. Cache counts, when reported, are part of input tokens. */
export type TokenPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
  cacheWritePerMillion?: number;
};

export type ClassifierCost =
  | {
      status: "estimated";
      currency: "USD";
      input: number;
      output: number;
      total: number;
      source: "builtin" | "configured";
      rates: TokenPricing;
      nonToken?: NonTokenCost;
    }
  | {
      status: "estimated";
      currency: "USD";
      input: number;
      output: number;
      total: number;
      source: "aggregated";
      nonToken?: NonTokenCost;
    }
  | {
      status: "unavailable";
      currency: "USD";
      reason:
        | "unknown_pricing"
        | "missing_usage"
        | "invalid_usage"
        | "missing_cache_pricing"
        | "calculation_overflow";
    };

export type RouteLimits = {
  maxQuestions: number;
  maxImages: number;
  maxAudio: number;
  maxVideo: number;
};

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  accountId?: string;
  /** Cloudflare AI Gateway selection; emitted as `cf-aig-gateway-id`. */
  gatewayId?: string;
  experimentalImages?: boolean;
  experimentalBox?: boolean;
  /** Microsoft Foundry accepts API-key or Entra bearer credentials on the same endpoint. */
  authMode?: "api-key" | "bearer" | "google-api-key" | "parallel-api-key" | "none";
  /** TypeSafe Jev long-context opt-in; sends `TypeSafe-Danger-Zone-Long-Context: true`. */
  longContext?: boolean;
  /** Model ID (or Azure deployment name) to explicit token rates. */
  pricing?: Record<string, TokenPricing>;
  /** Verified wire choice limit; needed for batching on endpoints without a known limit. */
  maxChoices?: number;
  /** Verified per-request envelope overrides for custom or account-specific endpoints. */
  limits?: Partial<RouteLimits>;
}

export interface CustomProviderSettings extends ProviderSettings {
  api: ApiStyle;
  models: ModelDefinition[];
}

export type ClassifierRoute = {
  provider: string;
  model: string;
};

export interface ClassifierSettings {
  computerUse?: import("./computer-use-types.js").ComputerUseSettings;
  none_of_above_choice?: boolean;
  remove_choice_limits?: boolean;
  default?: ClassifierRoute;
  fallback?: ClassifierRoute[];
  compare?: ClassifierRoute[];
  defaultProvider?: string;
  defaultModel?: string;
  requestTimeoutMs?: number;
  providers?: Record<string, ProviderSettings>;
  customProviders?: Record<string, CustomProviderSettings>;
}

export interface ResolvedModel {
  route: string;
  provider: string;
  model: string;
  api: ApiStyle;
  /** Provider wire format used by the selected route. */
  mediaFormat: "jev-assets" | "base64-object" | "openrouter-parts";
  baseUrl: string;
  headers: Record<string, string>;
  gatewayId?: string;
  configuredApiKey?: string;
  credentialProvider: string;
  envVar?: string;
  images: boolean;
  audio: boolean;
  video: boolean;
  box: boolean;
  experimentalImages: boolean;
  authMode: "api-key" | "bearer" | "subscription-key" | "google-api-key" | "parallel-api-key" | "none";
  longContext: boolean;
  requestTimeoutMs: number;
  /** Envelope used before a request; values come from verified route contracts or explicit settings. */
  limits: RouteLimits;
  pricing?: { rates: TokenPricing; source: "builtin" | "configured" };
  maxChoices?: number;
}

export interface PreparedLocalImage {
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
}

export type PreparedImage = (PreparedLocalImage | { url: string }) & { id?: string };

export type PreparedMedia = {
  type: "audio" | "video";
  mimeType: string;
  data: string;
};

export interface PreparedInput {
  state: ClassifyParams["state"];
  questions: Record<string, Question>;
  images: PreparedImage[];
  media: PreparedMedia[];
  mode?: ClassifyParams["mode"];
  conversation?: ClassifyParams["conversation"];
  imageDetail?: ClassifyParams["imageDetail"];
  promptCache?: ClassifyParams["promptCache"];
}

export type ClassifierResult = {
  provider: string;
  model: string;
  answers: Record<string, Answer>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
  };
  /** Successful provider requests made by automatic choice processing. */
  providerCalls?: number;
  /** Estimate for completed requests in this result, not an invoice or total of failed attempts. */
  cost: ClassifierCost;
  /** Gateway/provider-reported charge when the API exposes one; never substituted for the token estimate. */
  providerCost?: ProviderCost;
  /** Request-wide web evidence returned by grounded Decision APIs such as Parallel. */
  citations?: DecisionCitation[];
  requestId?: string;
  /** Evidence returned by Perplexity web grounding, with the same order and counts as the provider response. */
  webGrounding?: {
    searchResults: WebSearchResult[];
    fetchedResults?: WebFetchedResult[];
  };
  attemptedRoutes?: ClassifierRoute[];
};

export type ClassifierComparisonEntry = ClassifierRoute & {
  durationMs: number;
} & (
  | { status: "success"; result: ClassifierResult }
  | { status: "error"; error: { code: string; message: string } }
);

export type ClassifierComparisonResult = {
  results: ClassifierComparisonEntry[];
  cancelled: boolean;
};

export class ClassifierError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ClassifierError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function userError(error: unknown): string {
  return error instanceof ClassifierError
    ? error.message
    : "Classification failed unexpectedly. Check the selected provider configuration.";
}

/** Cloudflare Clairic field specifications. Keys use the provider's documented names. */
export type ExtractionField = {
  type:
    | "text" | "number" | "compute" | "date" | "time" | "datetime" | "duration"
    | "boolean" | "enum" | "object" | "list" | "estimate" | "forecast";
  instructions?: string;
  nullable?: boolean;
  unit?: string;
  integer?: boolean;
  decimals?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: unknown[];
  knowledge?: boolean;
  source_only?: boolean;
  null_threshold?: number;
  properties?: Record<string, ExtractionField>;
  items?: "text" | "number" | "date" | { type: "object"; properties: Record<string, ExtractionField> };
  max_items?: number;
  min?: number | string;
  max?: number | string;
  step?:
    | number
    | "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
  scale?: "linear" | "log";
  horizon?: number;
  interval?: "step" | "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
};

export type ExtractParams = {
  state?: ClassifyParams["state"];
  fields: Record<string, ExtractionField>;
  images?: (string | { path: string; rotation?: 0 | 90 | 180 | 270 })[];
  documents?: string[];
  referenceDate?: string;
  options?: { includeQuantiles?: boolean; returnStateText?: boolean };
};

export type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike };

export type ExtractionAnswer = {
  type: string;
  value: JsonLike;
  [key: string]: JsonLike;
};

export type ExtractResult = {
  provider: string;
  model: string;
  answers: Record<string, ExtractionAnswer>;
  truncated: boolean;
  usage?: NonNullable<ClassifierResult["usage"]>;
  cost: ClassifierCost;
  providerCost?: ProviderCost;
  requestId?: string;
  stateText?: string;
};
