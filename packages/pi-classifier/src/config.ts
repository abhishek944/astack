import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadPiSettings,
  resolveConfigDir,
} from "@amaster.ai/pi-shared/settings";
import { cloudflareAccountId, type CredentialSource } from "./auth.js";
import { resolvePricing } from "./cost.js";
import { choicePolicy } from "./choices.js";
import {
  ClassifierError,
  isRecord,
  type ApiStyle,
  type ClassifierSettings,
  type ClassifierRoute,
  type ModelDefinition,
  type ProviderSettings,
  type ResolvedModel,
  type RouteLimits,
} from "./types.js";

export const SETTINGS_KEY = "pi-classifier";
export const BUILT_INS = [
  {
    id: "llamacpp",
    route: "llamacpp-api",
    api: "local-system-one",
    baseUrl: "",
    credentialProvider: "llamacpp",
    envVar: "",
    models: [
      { id: "LiquidAI/d1-2B", input: ["text", "image"] },
      { id: "LiquidAI/d1-Omni-2B", input: ["text", "image", "audio", "video"] },
      { id: "LiquidAI/d1-omni-600M", input: ["text", "image", "audio"] },
    ],
  },
  {
    id: "vllm",
    route: "vllm-api",
    api: "local-system-one",
    baseUrl: "",
    credentialProvider: "vllm",
    envVar: "VLLM_API_KEY",
    models: [
      { id: "Qwen/Qwen3-0.6B", input: ["text"] },
      { id: "LiquidAI/d1-3B", input: ["text", "image"] },
    ],
  },
  {
    id: "strands",
    route: "strands-api",
    api: "local-system-one",
    baseUrl: "",
    credentialProvider: "strands",
    envVar: "",
    models: [{ id: "StrandsAgents/strands-decider-E2B-gemma4-v1-2610", input: ["text"] }],
  },
  {
    id: "laya",
    route: "laya-api",
    api: "local-system-one",
    baseUrl: "",
    credentialProvider: "laya",
    envVar: "LAYA_API_KEY",
    models: [
      { id: "english", input: ["text"] },
      { id: "multilingual", input: ["text"] },
      { id: "typed-decisions", input: ["text"] },
    ],
  },
  {
    id: "nimble",
    route: "nimble-api",
    api: "local-system-one",
    baseUrl: "",
    credentialProvider: "nimble",
    envVar: "",
    models: [{ id: "nimble", input: ["text"] }],
  },
  {
    id: "openrouter",
    route: "openrouter-extractions-api",
    api: "openrouter-extractions",
    baseUrl: "https://openrouter.ai/api",
    credentialProvider: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    models: [
      { id: "cloudflare/clairic", input: ["text", "image"] },
      { id: "inception/mercury-decide", input: ["text"] },
      { id: "liquid/d1.2", input: ["text", "image"] },
      { id: "liquid/d1.2-ultra", input: ["text", "image"] },
      { id: "perplexity/pplx-decider-v1.3", input: ["text"] },
      { id: "perplexity/pplx-decider-flash-v1.3", input: ["text"] },
      { id: "scaledown/extract", input: ["text", "image"] },
    ],
  },
  {
    id: "litellm",
    route: "litellm-extraction-api",
    api: "litellm-extraction",
    baseUrl: "",
    credentialProvider: "litellm",
    envVar: "LITELLM_API_KEY",
    models: [{ id: "clairic", input: ["text", "image"] }],
  },
  {
    id: "microsoft",
    route: "microsoft-api",
    api: "microsoft-system-one",
    baseUrl: "",
    credentialProvider: "microsoft",
    envVar: "AZURE_API_KEY",
    models: [
      { id: "Microsoft-Decision-1.1", input: ["text", "image"] },
      { id: "Microsoft-Decision-1", input: ["text"] },
    ],
  },
  {
    id: "sarvam",
    route: "sarvam-api",
    api: "sarvam-system-one",
    baseUrl: "https://api.sarvam.ai/v2",
    credentialProvider: "sarvam",
    envVar: "SARVAM_API_KEY",
    models: [
      { id: "sarvam-prism", input: ["text"] },
      { id: "clef", input: ["text", "image"] },
    ],
  },
  {
    id: "openai",
    route: "openai-api",
    api: "openai-decisions",
    baseUrl: "https://api.openai.com/v1",
    credentialProvider: "openai",
    envVar: "OPENAI_API_KEY",
    models: [{ id: "gpt-6-luna", input: ["text", "image"] }],
  },
  {
    id: "vercel",
    route: "vercel-api",
    api: "openai-decisions",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    credentialProvider: "vercel",
    envVar: "VERCEL_AI_GATEWAY_API_KEY",
    models: [
      { id: "openai/gpt-6-luna-decisions", input: ["text", "image"] },
      { id: "typesafe-ai/jev", input: ["text"] },
    ],
  },
  {
    id: "gemini",
    route: "gemini-api",
    api: "gemini-decisions",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    credentialProvider: "gemini",
    envVar: "GEMINI_API_KEY",
    models: [
      { id: "gemini-decision-1", input: ["text", "image", "audio", "video"] },
    ],
  },
  {
    id: "inception",
    route: "inception-api",
    api: "inception-decisions",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    credentialProvider: "inception",
    envVar: "INCEPTION_API_KEY",
    models: [{ id: "mercury-decide", input: ["text", "image"] }],
  },
  {
    id: "parallel",
    route: "parallel-api",
    api: "parallel-decisions",
    baseUrl: "https://api.parallel.ai/v1",
    credentialProvider: "parallel",
    envVar: "PARALLEL_API_KEY",
    models: [{ id: "parallel-decisions", input: ["text"] }],
  },
  {
    id: "perplexity",
    route: "perplexity-api",
    api: "perplexity-decisions",
    baseUrl: "https://api.perplexity.ai/v1",
    credentialProvider: "perplexity",
    envVar: "PERPLEXITY_API_KEY",
    models: [
      { id: "pplx-decider-v1.3", input: ["text", "image"] },
      { id: "pplx-decider-flash-v1.3", input: ["text", "image"] },
      { id: "pplx-decider-v1.2", input: ["text", "image"] },
      { id: "pplx-decider-flash-v1.2", input: ["text", "image"] },
      { id: "pplx-decider-latest", input: ["text", "image"] },
      { id: "pplx-decider-flash-latest", input: ["text", "image"] },
      { id: "pplx-decider-v1.1-27b", input: ["text", "image"] },
      { id: "pplx-decider-v1-27b", input: ["text", "image"] },
    ],
  },
  {
    id: "liquid",
    route: "liquid-api",
    api: "liquid-system-one",
    baseUrl: "https://api.liquid.ai/decisions/v1",
    credentialProvider: "liquid",
    envVar: "LIQUID_API_KEY",
    models: [
      { id: "d1.2", input: ["text", "image", "audio"], box: true },
      { id: "d1.2-ultra", input: ["text", "image", "audio"], box: true },
    ],
  },
  {
    id: "typesafe",
    route: "typesafe-api",
    api: "system-one",
    baseUrl: "https://api.typesafe.ai/v1",
    credentialProvider: "typesafe",
    envVar: "TYPESAFE_API_KEY",
    models: [
      { id: "jev-latest", input: ["text", "image"] },
      { id: "jev-1.13.0", input: ["text", "image"] },
      { id: "jev-preview", input: ["text", "image"], box: true },
      { id: "jev-1.14.0", input: ["text", "image"], box: true },
    ],
  },
  {
    id: "cloudflare",
    route: "cloudflare-api",
    api: "cloudflare-system-one",
    baseUrl: "",
    credentialProvider: "cloudflare-workers-ai",
    envVar: "CLOUDFLARE_API_KEY",
    models: [
      { id: "@cf/cloudflare/clef", input: ["text", "image"] },
      { id: "@cf/cloudflare/clef-flash", input: ["text", "image"] },
      { id: "@cf/cloudflare/clef-omni", input: ["text", "image", "audio", "video"] },
      { id: "typesafe/jev" },
    ],
  },
  {
    id: "clairic",
    route: "clairic-api",
    api: "cloudflare-clairic",
    baseUrl: "",
    credentialProvider: "cloudflare-workers-ai",
    envVar: "CLOUDFLARE_API_KEY",
    models: [{ id: "@cf/cloudflare/clairic", input: ["text", "image"] }],
  },
  {
    id: "openrouter",
    route: "openrouter-api",
    api: "system-one",
    baseUrl: "https://openrouter.ai/api/v1",
    credentialProvider: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    models: [{ id: "typesafe/jev-1.13" }, { id: "~typesafe/jev-latest" }],
  },
  {
    id: "openrouter",
    route: "openrouter-decisions-api",
    api: "openrouter-decisions",
    baseUrl: "https://openrouter.ai/api",
    credentialProvider: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    models: [
      { id: "typesafe/jev-1.14", input: ["text", "image"], box: true },
      { id: "~typesafe/jev-latest", input: ["text", "image"], box: true },
      { id: "typesafe/jev-1.13", input: ["text", "image"] },
      { id: "microsoft/microsoft-decision-1.1", input: ["text", "image"] },
      { id: "cloudflare/clef-flash", input: ["text", "image"] },
      { id: "cloudflare/clef-omni", input: ["text", "image", "audio", "video"] },
      { id: "inception/mercury-decide", input: ["text", "image"] },
      { id: "liquid/d1.2", input: ["text", "image"] },
      { id: "liquid/d1.2-ultra", input: ["text", "image"] },
      { id: "openai/gpt-6-luna-decisions", input: ["text", "image"] },
      { id: "google/gemini-decision-1", input: ["text", "image", "audio", "video"] },
      { id: "heygen/heygen-decision-1", input: ["text", "image", "audio", "video"] },
      { id: "heygen/heygen-decision-1-turbo", input: ["text", "image", "audio", "video"] },
      { id: "parallel/parallel-decisions", input: ["text"] },
    ],
  },
] satisfies Array<{
  id: string;
  route: string;
  api: ApiStyle;
  baseUrl: string;
  credentialProvider: string;
  envVar: string;
  models: ModelDefinition[];
}>;

/** Keep legacy provider-id aliases pointed at their original classify route when one provider exposes several APIs. */
const PREFERRED_ROUTE_BY_ID: Record<string, string> = { openrouter: "openrouter-api" };

/** Largest documented envelope among built-in adapters; per-route limits narrow it before any request. */
const DEFAULT_LIMITS: RouteLimits = {
  maxQuestions: 1000,
  maxImages: 128,
  maxAudio: 10,
  maxVideo: 10,
};

export type OpenRouterExtractionCapabilities = {
  fieldTypes: string[];
  maxFields: number;
  maxImages: number;
  maxDocuments: number;
  maxAssets: number;
  referenceDate: boolean;
};

/** Field tiers from OpenRouter's Extractions guide; unknown models default to text-only. */
export function openRouterExtractionCapabilities(model: string): OpenRouterExtractionCapabilities {
  const textOnly = { fieldTypes: ["text", "list"], maxFields: 128, maxImages: 0, maxDocuments: 0, maxAssets: 0, referenceDate: false };
  if (model === "cloudflare/clairic")
    return {
      fieldTypes: ["text", "number", "date", "time", "datetime", "duration", "list", "estimate", "forecast"],
      maxFields: 128,
      maxImages: 4,
      maxDocuments: 0,
      maxAssets: 4,
      referenceDate: true,
    };
  if (/^liquid\/d1\.2/.test(model))
    return { fieldTypes: ["text", "number", "date", "list", "estimate"], maxFields: 128, maxImages: 8, maxDocuments: 0, maxAssets: 8, referenceDate: false };
  if (model === "scaledown/extract")
    return { ...textOnly, maxImages: 1, maxDocuments: 1, maxAssets: 1 };
  if (/^inference-net\/schematron-v2-/.test(model))
    return { ...textOnly, fieldTypes: ["text", "number", "date", "time", "datetime", "list"] };
  return textOnly;
}

export type OpenRouterDecisionCapabilities = {
  flexibleImagePlacement: boolean;
  box: boolean;
  remoteImageUrls: boolean;
  images: number;
  audio: number;
  video: number;
};

/** Defaults come from OpenRouter's published Decisions adapter registry and multimodal limits. */
export function openRouterDecisionCapabilities(model: string): OpenRouterDecisionCapabilities {
  if (/^~?typesafe\/jev-(?:1\.14|latest)$/.test(model))
    return { flexibleImagePlacement: true, box: true, remoteImageUrls: false, images: 128, audio: 0, video: 0 };
  if (model === "typesafe/jev-1.13")
    return { flexibleImagePlacement: true, box: false, remoteImageUrls: false, images: 128, audio: 0, video: 0 };
  if (model === "microsoft/microsoft-decision-1.1")
    return { flexibleImagePlacement: true, box: false, remoteImageUrls: false, images: 8, audio: 0, video: 0 };
  if (model === "cloudflare/clef-omni")
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 4, audio: 4, video: 2 };
  if (/^cloudflare\/clef(?:-flash)?$/.test(model))
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 4, audio: 0, video: 0 };
  if (/^heygen\/heygen-decision-1(?:-turbo)?$/.test(model))
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: true, images: 100, audio: 10, video: 10 };
  if (model === "google/gemini-decision-1")
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: true, images: 128, audio: 10, video: 10 };
  if (model === "inception/mercury-decide")
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 16, audio: 0, video: 0 };
  if (/^liquid\/d1(?:\.2(?:-ultra)?|-2B|-omni.*)?$/.test(model))
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 8, audio: 0, video: 0 };
  if (/^baseten\//.test(model) || /^morph\//.test(model))
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 16, audio: 0, video: 0 };
  if (/^deepinfra\//.test(model) || /^makora\//.test(model) || /^prime-intellect\//.test(model))
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 4, audio: 0, video: 0 };
  if (model === "openai/gpt-6-luna-decisions")
    return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 128, audio: 0, video: 0 };
  return { flexibleImagePlacement: false, box: false, remoteImageUrls: false, images: 0, audio: 0, video: 0 };
}

function builtInLimits(api: ApiStyle, provider: string | undefined, model: string): RouteLimits {
  if (api === "openai-decisions")
    return { ...DEFAULT_LIMITS, maxQuestions: 400 };
  if (api === "openrouter-extractions") {
    const caps = openRouterExtractionCapabilities(model);
    return { ...DEFAULT_LIMITS, maxImages: caps.maxImages, maxAudio: 0, maxVideo: 0 };
  }
  if (api === "litellm-extraction")
    return { ...DEFAULT_LIMITS, maxImages: 4, maxAudio: 0, maxVideo: 0 };
  if (api === "parallel-decisions")
    return { ...DEFAULT_LIMITS, maxQuestions: 100, maxImages: 0, maxAudio: 0, maxVideo: 0 };
  if (api === "local-system-one") {
    const maxQuestions =
      provider === "vllm" ? 64 : provider === "laya" ? 32 : provider === "nimble" ? 64 : provider === "strands" ? 32 : DEFAULT_LIMITS.maxQuestions;
    const maxImages = provider === "llamacpp" || provider === "vllm" || provider === "strands" ? DEFAULT_LIMITS.maxImages : 0;
    return { ...DEFAULT_LIMITS, maxQuestions, maxImages };
  }
  if (api === "openrouter-decisions") {
    const caps = openRouterDecisionCapabilities(model);
    return { ...DEFAULT_LIMITS, maxImages: caps.images, maxAudio: caps.audio, maxVideo: caps.video };
  }
  if (api === "perplexity-decisions")
    return { ...DEFAULT_LIMITS, maxQuestions: 128, maxImages: 8, maxAudio: 0, maxVideo: 0 };
  if (api === "liquid-system-one")
    return { ...DEFAULT_LIMITS, maxQuestions: 128, maxImages: 8, maxAudio: 8, maxVideo: 0 };
  if (api === "cloudflare-system-one") {
    const omni = model === "@cf/cloudflare/clef-omni";
    const clef = provider === "cloudflare" && model.startsWith("@cf/cloudflare/clef");
    return {
      ...DEFAULT_LIMITS,
      maxQuestions: clef ? 64 : DEFAULT_LIMITS.maxQuestions,
      maxImages: clef ? 4 : 0,
      maxAudio: omni ? 4 : 0,
      maxVideo: omni ? 2 : 0,
    };
  }
  if (api === "microsoft-system-one")
    return { ...DEFAULT_LIMITS, maxAudio: 0, maxVideo: 0 };
  if (api === "sarvam-system-one")
    return { ...DEFAULT_LIMITS, maxImages: model === "clef" ? DEFAULT_LIMITS.maxImages : 0, maxAudio: 0, maxVideo: 0 };
  return { ...DEFAULT_LIMITS };
}

function configuredLimits(
  value: unknown,
  api: ApiStyle,
  provider: string | undefined,
  model: string,
): RouteLimits {
  const base = builtInLimits(api, provider, model);
  if (value === undefined) return base;
  if (!isRecord(value) || Object.keys(value).some((key) => !["maxQuestions", "maxImages", "maxAudio", "maxVideo"].includes(key)))
    return configuration(
      "limits may only set maxQuestions, maxImages, maxAudio and maxVideo.",
    );
  const limits = { ...base };
  for (const key of ["maxQuestions", "maxImages", "maxAudio", "maxVideo"] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    const minimum = key === "maxQuestions" ? 1 : 0;
    if (!Number.isSafeInteger(entry) || (entry as number) < minimum)
      return configuration(
        key + " must be a safe integer of at least " + minimum + ".",
      );
    limits[key] = entry as number;
  }
  return limits;
}

export function loadClassifierSettings(
  cwd: string,
  projectTrusted = false,
): ClassifierSettings {
  try {
    // The shared loader is forgiving; malformed layers must not silently select a different route.
    const paths = new Set([
      join(resolveConfigDir(join(homedir(), ".pi", "agent")), "settings.json"),
      join(resolveConfigDir(), "settings.json"),
      ...(projectTrusted ? [join(cwd, ".pi", "settings.json")] : []),
    ]);
    for (const path of paths) validateSettingsLayer(path);
    const settings = loadPiSettings<ClassifierSettings>(SETTINGS_KEY, {
      cwd,
      projectTrusted,
      strictProjectSettings: true,
    });
    if (!isRecord(settings)) throw new Error();
    return settings;
  } catch (error) {
    if (error instanceof ClassifierError) throw error;
    throw new ClassifierError(
      "configuration",
      "Could not load pi-classifier settings. Check that the namespace contains a valid JSON object.",
    );
  }
}

function validateSettingsLayer(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (text.charCodeAt(0) === 0xfeff)
    configuration(
      "pi-classifier settings require UTF-8 without a BOM. Remove the BOM from settings.json; no alternate configuration was used.",
    );
  const root: unknown = JSON.parse(text);
  if (
    !isRecord(root) ||
    (Object.hasOwn(root, SETTINGS_KEY) && !isRecord(root[SETTINGS_KEY]))
  )
    configuration(
      "Settings and the pi-classifier namespace must be JSON objects, not null or arrays.",
    );
}

function configuration(message: string): never {
  throw new ClassifierError("configuration", message);
}

export function validateBaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.toString().replace(/\/+$/, "");
  } catch {
    return configuration(
      "Provider baseUrl must be HTTPS (or loopback HTTP), without credentials, query or fragment.",
    );
  }
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    return configuration(field + " must be a non-empty string.");
  return value.trim();
}

function headers(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (
    !isRecord(value) ||
    Object.entries(value).some(
      ([key, entry]) =>
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
        typeof entry !== "string" ||
        /[\r\n]/.test(entry),
    )
  ) {
    return configuration(
      "Provider headers must be a string map with valid HTTP header names and values.",
    );
  }
  const protectedNames = [
    "authorization",
    "api-key",
    "api-subscription-key",
    "content-type",
    "content-length",
    "host",
    "cookie",
    "proxy-authorization",
    "transfer-encoding",
    "connection",
  ];
  if (
    Object.values(value).some(
      (entry) => typeof entry === "string" && /\$\{?[A-Z_]/.test(entry),
    )
  )
    return configuration(
      "Resolve header environment references in global settings, not project settings.",
    );
  if (
    Object.keys(value).some((key) => protectedNames.includes(key.toLowerCase()))
  )
    return configuration(
      "Authentication and transport headers cannot be overridden.",
    );
  return value as Record<string, string>;
}

export function configuredDefault(settings: ClassifierSettings): ClassifierRoute {
  if (settings.default !== undefined)
    return routePair(settings.default, "default");
  return routePair(
    { provider: settings.defaultProvider, model: settings.defaultModel },
    "defaultProvider/defaultModel",
  );
}

function routePair(value: unknown, field: string): ClassifierRoute {
  if (!isRecord(value))
    return configuration(field + " must be a provider/model pair.");
  const provider = optionalString(value.provider, field + ".provider");
  const model = optionalString(value.model, field + ".model");
  if (!provider || !model)
    return configuration(field + " requires provider and model.");
  return { provider, model };
}

export function configuredRoutes(
  settings: ClassifierSettings,
  field: "fallback" | "compare",
): ClassifierRoute[] {
  const value = settings[field];
  if (value === undefined) return [];
  if (!Array.isArray(value))
    return configuration(field + " must be an array of provider/model pairs.");
  return value.map((entry, index) => routePair(entry, field + "[" + index + "]"));
}

export function resolveModel(
  settings: ClassifierSettings,
  selected: ClassifierRoute = configuredDefault(settings),
  source: CredentialSource = "pi-store",
): ResolvedModel {
  choicePolicy(settings);
  const { provider: routeId, model: modelId } = routePair(selected, "route");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(routeId) ||
    modelId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(modelId)
  )
    return configuration(
      "Provider routes must be short identifiers and model IDs must be at most 256 characters without control characters.",
    );
  const builtIn =
    BUILT_INS.find((entry) => entry.route === routeId) ??
    BUILT_INS.find((entry) => entry.route === PREFERRED_ROUTE_BY_ID[routeId]) ??
    BUILT_INS.find((entry) => entry.id === routeId);
  if (settings.providers !== undefined && !isRecord(settings.providers))
    return configuration("providers must be an object.");
  if (
    settings.customProviders !== undefined &&
    !isRecord(settings.customProviders)
  )
    return configuration("customProviders must be an object.");
  for (const name of Object.keys(settings.customProviders ?? {})) {
    if (BUILT_INS.some((entry) => entry.route === name || entry.id === name))
      return configuration("Custom providers cannot shadow built-in routes.");
  }
  const custom = builtIn ? undefined : settings.customProviders?.[routeId];
  if (!builtIn && !custom)
    return configuration("Unknown classifier provider route.");
  const raw: ProviderSettings = builtIn
    ? (settings.providers?.[builtIn.id] ?? {})
    : custom!;
  if (!isRecord(raw))
    return configuration("Provider settings must be an object.");
  const api = builtIn?.api ?? custom!.api;
  if (
    ![
      "openai-decisions",
      "openrouter-decisions",
      "gemini-decisions",
      "inception-decisions",
      "parallel-decisions",
      "local-system-one",
      "perplexity-decisions",
      "sarvam-system-one",
      "system-one",
      "liquid-system-one",
      "cloudflare-system-one",
      "cloudflare-clairic",
      "openrouter-extractions",
      "litellm-extraction",
      "microsoft-system-one",
    ].includes(api)
  )
    return configuration("Unsupported classifier API protocol.");
  const models: ModelDefinition[] = builtIn?.models ?? custom!.models;
  if (
    !Array.isArray(models) ||
    models.length === 0 ||
    models.some(
      (m) =>
        !isRecord(m) ||
        typeof m.id !== "string" ||
        !m.id.trim() ||
        (m.input !== undefined &&
          (!Array.isArray(m.input) ||
            m.input.some(
              (x) => x !== "text" && x !== "image" && x !== "audio" && x !== "video",
            ))) ||
        (m.box !== undefined && typeof m.box !== "boolean"),
    )
  ) {
    return configuration(
      "Provider models must declare an id and optional text/image input capabilities.",
    );
  }
  const definition = models.find((entry) => entry.id === modelId);
  // Built-in API routes allow new text model IDs without a package release. Images require known capabilities.
  if (!definition && !builtIn)
    return configuration(
      "The selected model is not declared in customProviders.<id>.models.",
    );
  for (const flag of ["experimentalImages", "experimentalBox", "longContext"] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== "boolean")
      return configuration(flag + " must be a boolean.");
  }
  const authMode = raw.authMode;
  if (authMode !== undefined && authMode !== "api-key" && authMode !== "bearer" && authMode !== "google-api-key" && authMode !== "parallel-api-key" && authMode !== "none")
    return configuration("authMode must be api-key, bearer, google-api-key, parallel-api-key or none.");
  if (authMode === "none" && api !== "local-system-one")
    return configuration("authMode none is supported only by local System One routes.");
  const resolvedAuthMode: ResolvedModel["authMode"] =
    authMode ??
    (api === "microsoft-system-one"
      ? "api-key"
      : api === "sarvam-system-one"
        ? authMode ?? "subscription-key"
        : api === "gemini-decisions"
          ? "google-api-key"
          : api === "parallel-decisions"
            ? "parallel-api-key"
            : api === "local-system-one"
              ? "none"
              : "bearer");
  let baseUrl = optionalString(raw.baseUrl, "baseUrl") ?? builtIn?.baseUrl;
  if ((api === "cloudflare-system-one" || api === "cloudflare-clairic") && !baseUrl)
    baseUrl =
      "https://api.cloudflare.com/client/v4/accounts/" +
      cloudflareAccountId(optionalString(raw.accountId, "accountId"), source) +
      "/ai";
  if (!baseUrl)
    return configuration(
      "The selected provider requires a baseUrl. Microsoft uses your Foundry resource endpoint; local runtimes use your server URL.",
    );
  const timeout = settings.requestTimeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 300_000)
    return configuration("requestTimeoutMs must be between 100 and 300000.");
  if (raw.apiKey !== undefined && typeof raw.apiKey !== "string")
    return configuration("apiKey must be a string.");
  const configuredApiKey =
    typeof raw.apiKey === "string" ? raw.apiKey.trim() || undefined : undefined;
  if (configuredApiKey && /\$\{?|^!/.test(configuredApiKey))
    return configuration(
      "API-key references must be resolved in global settings; project settings cannot expand environment variables or execute commands.",
    );
  const gatewayId = optionalString(raw.gatewayId, "gatewayId");
  if (gatewayId !== undefined && (/[\r\n]/.test(gatewayId) || /\$\{?[A-Z_]/.test(gatewayId)))
    return configuration(
      "Gateway IDs must be resolved in global settings and cannot contain line breaks.",
    );
  const resolvedHeaders = headers(raw.headers);
  if (
    (api === "cloudflare-system-one" || api === "cloudflare-clairic") &&
    gatewayId !== undefined
  ) {
    for (const key of Object.keys(resolvedHeaders))
      if (key.toLowerCase() === "cf-aig-gateway-id" && key !== "cf-aig-gateway-id")
        delete resolvedHeaders[key];
    resolvedHeaders["cf-aig-gateway-id"] = gatewayId;
  }
  const isJevDirect = builtIn?.id === "typesafe";
  const openRouter = api === "openrouter-decisions" ? openRouterDecisionCapabilities(modelId) : undefined;
  const result: ResolvedModel = {
    route: builtIn?.route ?? routeId,
    provider: builtIn?.id ?? routeId,
    model: modelId,
    api,
    mediaFormat: api === "system-one" ? "jev-assets" : openRouter ? "openrouter-parts" : "base64-object",
    baseUrl: validateBaseUrl(baseUrl),
    headers: resolvedHeaders,
    ...(gatewayId !== undefined ? { gatewayId } : {}),
    credentialProvider: builtIn?.credentialProvider ?? routeId,
    images:
      openRouter
        ? openRouter.images > 0
        : api === "system-one"
          ? Boolean(
              raw.experimentalImages && definition?.input?.includes("image"),
            )
          : Boolean(definition?.input?.includes("image")),
    audio: openRouter
      ? openRouter.audio > 0
      : Boolean(
          (api === "liquid-system-one" ||
            api === "cloudflare-system-one" ||
            api === "gemini-decisions" ||
            api === "local-system-one") &&
            definition?.input?.includes("audio"),
        ),
    video: openRouter
      ? openRouter.video > 0
      : Boolean(
          (api === "cloudflare-system-one" ||
            api === "gemini-decisions" ||
            api === "local-system-one") &&
            definition?.input?.includes("video"),
        ),
    box: Boolean(
      openRouter
        ? openRouter.box &&
          definition?.box &&
          definition?.input?.includes("image") &&
          raw.experimentalBox &&
          raw.experimentalImages
        : api === "liquid-system-one"
          ? definition?.box && definition?.input?.includes("image")
          : (isJevDirect || custom?.api === "system-one") &&
            definition?.box &&
            definition?.input?.includes("image") &&
            raw.experimentalBox &&
            raw.experimentalImages,
    ),
    experimentalImages: raw.experimentalImages === true,
    authMode: resolvedAuthMode,
    longContext: raw.longContext === true,
    requestTimeoutMs: timeout,
    limits: configuredLimits(raw.limits, api, builtIn?.id, modelId),
  };
  const pricing = resolvePricing(
    result.provider,
    modelId,
    result.baseUrl,
    raw.pricing,
  );
  if (pricing) result.pricing = pricing;
  if (raw.maxChoices !== undefined) {
    if (
      typeof raw.maxChoices !== "number" ||
      !Number.isSafeInteger(raw.maxChoices) ||
      raw.maxChoices < 2
    )
      return configuration(
        "Provider maxChoices must be a safe integer of at least 2.",
      );
    result.maxChoices = raw.maxChoices;
  } else {
    const knownLimit = knownMaxChoices(result);
    if (knownLimit !== undefined) result.maxChoices = knownLimit;
  }
  if (configuredApiKey) result.configuredApiKey = configuredApiKey;
  if (builtIn?.envVar) result.envVar = builtIn.envVar;
  return result;
}

function knownMaxChoices(route: ResolvedModel): number | undefined {
  const directJev =
    route.provider === "typesafe" &&
    route.baseUrl === "https://api.typesafe.ai/v1" &&
    ["jev-latest", "jev-preview", "jev-1.13.0", "jev-1.14.0"].includes(route.model);
  const sarvam =
    route.provider === "sarvam" &&
    route.baseUrl === "https://api.sarvam.ai/v2" &&
    route.model === "sarvam-prism";
  const openai =
    (route.provider === "openai" &&
      route.baseUrl === "https://api.openai.com/v1" &&
      route.model === "gpt-6-luna") ||
    (route.provider === "vercel" &&
      route.baseUrl === "https://ai-gateway.vercel.sh/v1" &&
      ["openai/gpt-6-luna-decisions", "typesafe-ai/jev"].includes(route.model));
  const perplexity =
    route.provider === "perplexity" &&
    route.baseUrl === "https://api.perplexity.ai/v1" &&
    [
      "pplx-decider-v1.1-27b",
      "pplx-decider-v1-27b",
      "pplx-decider-v1.3",
      "pplx-decider-flash-v1.3",
      "pplx-decider-v1.2",
      "pplx-decider-latest",
      "pplx-decider-flash-v1.2",
      "pplx-decider-flash-latest",
    ].includes(route.model);
  const clef =
    route.provider === "cloudflare" &&
    /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai$/.test(route.baseUrl) &&
    ["@cf/cloudflare/clef", "@cf/cloudflare/clef-flash", "@cf/cloudflare/clef-omni"].includes(route.model);
  const liquid =
    route.provider === "liquid" &&
    route.baseUrl === "https://api.liquid.ai/decisions/v1" &&
    ["d1.2", "d1.2-ultra"].includes(route.model);
  return directJev || sarvam || openai || perplexity || clef || liquid ? 255 : undefined;
}

export function listModels(settings: ClassifierSettings): string {
  const lines = BUILT_INS.flatMap((provider) =>
    provider.models.map((model) => provider.route + "  " + model.id),
  );
  for (const [id, provider] of Object.entries(settings.customProviders ?? {})) {
    if (Array.isArray(provider?.models))
      for (const model of provider.models)
        if (typeof model?.id === "string")
          lines.push(JSON.stringify(id) + "  " + JSON.stringify(model.id));
  }
  return lines.join("\n");
}
