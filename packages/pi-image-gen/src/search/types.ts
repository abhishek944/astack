import type { ImageResize } from '../types/image.js';

/** Search routes never contain generation model ids or generation credentials. */
export const IMAGE_SEARCH_PROVIDERS = [
  'serper', 'brave', 'serpapi', 'openverse', 'tavily', 'parallel', 'openai-responses',
] as const;
export type ImageSearchProvider = typeof IMAGE_SEARCH_PROVIDERS[number];
export type ImageSearchRoute = { provider: ImageSearchProvider };
export type ImageSearchParallelMode = 'fast' | 'advanced';
export type ImageSearchProviderConfig = {
  apiKey?: string;
  /** parallel only: documented Images API mode. Defaults to fast. */
  mode?: ImageSearchParallelMode;
  /** openai-responses only: Responses model used with web_search image results. */
  model?: string;
};

export type ImageSearchSettings = {
  default?: ImageSearchRoute;
  fallback?: ImageSearchRoute[];
  compare?: ImageSearchRoute[];
  /** Whole-search deadline, including fallback and downloads. Default 30 seconds; 1–120 seconds. */
  requestTimeoutMs?: number;
  /** Openverse can run without an apiKey. */
  providers?: Partial<Record<ImageSearchProvider, ImageSearchProviderConfig>>;
};

export type ImageSearchParams = {
  query: string;
  limit?: number;
  /** Optional exact-sized PNG copy of validated downloads. */
  resize?: ImageResize;
  /** Download directory, relative to options.cwd; default var/pi-image-gen/search. */
  outputDir?: string;
};
export type ImageSearchRejection = { imageUrl: string; reason: string };
/** Provider hints before download validation; not a usable local image yet. */
export type ImageSearchCandidate = {
  provider: ImageSearchProvider;
  imageUrl: string;
  title?: string;
  providerResultId?: string;
  thumbnailUrl?: string;
  sourcePageUrl?: string;
  width?: number;
  height?: number;
  creator?: string;
  creatorUrl?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
};
/** Every successful search image has a validated, saved local file. */
export type ImageSearchImage = ImageSearchCandidate & {
  path: string;
  originalPath?: string;
  mimeType: string;
  /** Measured saved-file dimensions, not the provider's width/height hints. */
  dimensions: { width: number; height: number };
};
export type ImageSearchAttempt = {
  route: ImageSearchRoute;
  status: 'success' | 'failed';
  error?: string;
};
export type ImageSearchResult = {
  query: string;
  provider: ImageSearchProvider;
  images: ImageSearchImage[];
  attempts: ImageSearchAttempt[];
  /** Failed/unsupported candidates excluded from images. */
  rejected: ImageSearchRejection[];
};
export type ImageSearchCompareEntry =
  | { route: ImageSearchRoute; status: 'success'; result: ImageSearchResult }
  | { route: ImageSearchRoute; status: 'failed' | 'cancelled'; error: string };
export type ImageSearchCompareResult = { entries: ImageSearchCompareEntry[] };
export type ImageSearchOptions = { settings: ImageSearchSettings; signal?: AbortSignal; cwd?: string };
