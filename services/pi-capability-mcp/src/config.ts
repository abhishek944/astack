import type { ClassifierSettings } from "@abhishek944/pi-classifier";
import type { ImageGenSettings } from "@abhishek944/pi-image-gen";
import type { ImageSearchSettings } from "@abhishek944/pi-image-gen/search";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const CompletionSettingsSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    baseUrl: Type.String({ minLength: 1 }),
    api: Type.Union([Type.Literal("openai-completions"), Type.Literal("openai-responses")]),
    model: Type.String({ minLength: 1 }),
    apiKeyEnv: Type.String({ minLength: 1 }),
    customerHeader: Type.Optional(Type.String({ minLength: 1 })),
    contextWindow: Type.Integer({ minimum: 1 }),
    maxTokens: Type.Integer({ minimum: 1 }),
    reasoning: Type.Optional(Type.Boolean()),
    vision: Type.Optional(Type.Boolean()),
    inputCostPerToken: Type.Number({ minimum: 0 }),
    outputCostPerToken: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type CompletionSettings = Static<typeof CompletionSettingsSchema>;

const RuntimeTokenSchema = Type.Array(
  Type.Object(
    {
      name: Type.String({ minLength: 1 }),
      tokenHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
      tools: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
);

type RuntimeToken = Static<typeof RuntimeTokenSchema>[number];

export interface Principal {
  readonly id: string;
  readonly tools: ReadonlySet<string>;
}

export interface ServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly redisUrl: string;
  readonly workingDirectory: string;
  readonly jobWaitTimeoutMs: number;
  readonly httpRequestTimeoutMs: number;
  readonly expectedClientTimeoutMs: number;
  readonly tokens: ReadonlyMap<string, Principal>;
  readonly imageSettings: ImageGenSettings;
  readonly imageSearchSettings: ImageSearchSettings;
  readonly classifierSettings: ClassifierSettings;
  readonly completionSettings: CompletionSettings | undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const raw = required(env, name);
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonObject(env: NodeJS.ProcessEnv, name: string): Record<string, unknown> {
  const raw = required(env, name);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
  if (!isPlainRecord(parsed)) throw new Error(`${name} must contain a JSON object`);
  return parsed;
}

function completionSettings(env: NodeJS.ProcessEnv): CompletionSettings | undefined {
  const raw = env.MCP_COMPLETION_SETTINGS_JSON;
  if (raw === undefined || raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MCP_COMPLETION_SETTINGS_JSON must contain valid JSON");
  }
  if (!Value.Check(CompletionSettingsSchema, parsed)) {
    throw new Error("MCP_COMPLETION_SETTINGS_JSON has an invalid completion setting");
  }
  return parsed;
}

function tokenMap(env: NodeJS.ProcessEnv): ReadonlyMap<string, Principal> {
  const raw = required(env, "MCP_RUNTIME_TOKENS_JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MCP_RUNTIME_TOKENS_JSON must contain valid JSON");
  }
  if (!Value.Check(RuntimeTokenSchema, parsed)) {
    throw new Error("MCP_RUNTIME_TOKENS_JSON has an invalid token record");
  }
  const entries = parsed as RuntimeToken[];
  const map = new Map<string, Principal>();
  const names = new Set<string>();
  for (const entry of entries) {
    const hash = entry.tokenHash.toLowerCase();
    if (map.has(hash)) throw new Error(`Duplicate runtime token hash for: ${entry.name}`);
    if (names.has(entry.name)) throw new Error(`Duplicate runtime token name: ${entry.name}`);
    names.add(entry.name);
    map.set(hash, {
      id: entry.name,
      tools: new Set(entry.tools),
    });
  }
  return map;
}

/** Parse and validate operator settings before any listener or queue exists. */
export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const jobWaitTimeoutMs = positiveInteger(env, "MCP_JOB_WAIT_TIMEOUT_MS");
  const httpRequestTimeoutMs = positiveInteger(env, "MCP_HTTP_REQUEST_TIMEOUT_MS");
  const expectedClientTimeoutMs = positiveInteger(env, "MCP_EXPECTED_CLIENT_TIMEOUT_MS");

  if (httpRequestTimeoutMs <= jobWaitTimeoutMs) {
    throw new Error("MCP_HTTP_REQUEST_TIMEOUT_MS must exceed MCP_JOB_WAIT_TIMEOUT_MS");
  }
  if (expectedClientTimeoutMs < httpRequestTimeoutMs) {
    throw new Error("MCP_EXPECTED_CLIENT_TIMEOUT_MS must be at least MCP_HTTP_REQUEST_TIMEOUT_MS");
  }

  return {
    host: env.MCP_HOST?.trim() || "127.0.0.1",
    port: positiveInteger(env, "MCP_PORT"),
    redisUrl: required(env, "MCP_REDIS_URL"),
    workingDirectory: required(env, "MCP_WORKING_DIRECTORY"),
    jobWaitTimeoutMs,
    httpRequestTimeoutMs,
    expectedClientTimeoutMs,
    tokens: tokenMap(env),
    // The capability packages own the detailed validation when a call runs.
    imageSettings: jsonObject(env, "MCP_IMAGE_SETTINGS_JSON") as ImageGenSettings,
    imageSearchSettings: jsonObject(env, "MCP_IMAGE_SEARCH_SETTINGS_JSON") as ImageSearchSettings,
    classifierSettings: jsonObject(env, "MCP_CLASSIFIER_SETTINGS_JSON") as ClassifierSettings,
    completionSettings: completionSettings(env),
  };
}
