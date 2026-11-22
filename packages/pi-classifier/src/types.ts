export type ApiStyle =
  | "openai-decisions"
  | "perplexity-decisions"
  | "system-one"
  | "liquid-system-one"
  | "cloudflare-system-one"
  | "cloudflare-clairic"
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
  | { type: "choice"; instructions: QuestionContent; criteria: Record<string, QuestionContent> }
  | { type: "score"; instructions: QuestionContent; criteria: QuestionContent[] }
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
  | { type: "text"; text: string; span?: CharSpan | null; found?: number }
  | { type: "number"; value: number | null; unit?: string | null; text?: string | null; span?: CharSpan | null; found?: number }
  | { type: "date"; date: string | null; text?: string | null; span?: CharSpan | null; found?: number }
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
  /** Explicit opt-in to Perplexity web search and page fetching. This can upload state text and incur per-search fees. */
  mode?: "web_grounding";
  /** Maximum stored-page age in seconds for a URL-only state with web grounding. */
  maxStaleness?: number;
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

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  accountId?: string;
  experimentalImages?: boolean;
  experimentalBox?: boolean;
  /** Model ID (or Azure deployment name) to explicit token rates. */
  pricing?: Record<string, TokenPricing>;
  /** Verified wire choice limit; needed for batching on endpoints without a known limit. */
  maxChoices?: number;
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
  mediaFormat: "jev-assets" | "base64-object";
  baseUrl: string;
  headers: Record<string, string>;
  configuredApiKey?: string;
  credentialProvider: string;
  envVar?: string;
  images: boolean;
  audio: boolean;
  video: boolean;
  box: boolean;
  experimentalImages: boolean;
  requestTimeoutMs: number;
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
  maxStaleness?: number;
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
  images?: string[];
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
  requestId?: string;
  stateText?: string;
};
