import { resolveApiKey, type CredentialSource } from "./auth.js";
import { resolveModel } from "./config.js";
import { estimateCost, tokenCount } from "./cost.js";
import { postJson } from "./http.js";
import { prepareExtractionInput, type PreparedExtractionInput } from "./inputs.js";
import { unwrapCloudflare } from "./providers.js";
import {
  ClassifierError,
  isRecord,
  userError,
  type ClassifierCost,
  type ExtractParams,
  type JsonLike,
  type ExtractResult,
} from "./types.js";

export type ExtractOptions = {
  settings: import("./types.js").ClassifierSettings;
  cwd: string;
  signal?: AbortSignal;
  credentialSource?: CredentialSource;
};

const CLAIRIC_LABEL = "Cloudflare Clairic";
const ANSWER_METADATA = [
  "valid", "complete", "decoder", "tokens", "raw", "retry_input_tokens", "null_recovered",
  "guess", "p_null", "p_null_method", "p_nulls", "confidence", "confidences", "confidence_method", "log_probability",
  "span", "spans", "path", "property_spans", "span_method", "grounding_method", "printed_value", "normalization_method", "failure_reason", "source",
  "unit", "mean", "median", "p10", "p90", "p_below", "p_above", "quantiles", "steps",
] as const;

function usageFrom(value: unknown): ExtractResult["usage"] {
  if (!isRecord(value)) return undefined;
  const input = tokenCount(value.input_tokens);
  const output = tokenCount(value.output_tokens);
  if (input === undefined || output === undefined) return undefined;
  return { inputTokens: input, outputTokens: output, totalTokens: input + output };
}

function reportedCost(value: unknown): ExtractResult["providerCost"] {
  if (!isRecord(value) || typeof value.cost !== "number" || !Number.isFinite(value.cost) || value.cost < 0)
    return undefined;
  return { currency: "USD", total: value.cost, source: "provider" };
}

function jsonLike(value: unknown): value is JsonLike {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonLike);
  if (!isRecord(value)) return false;
  return Object.values(value).every(jsonLike);
}

function parseAnswers(value: unknown, fields: ExtractParams["fields"]): Record<string, ExtractResult["answers"][string]> {
  if (!isRecord(value)) throw new ClassifierError("response", CLAIRIC_LABEL + " returned invalid answers.");
  const answers: Record<string, ExtractResult["answers"][string]> = Object.create(null);
  for (const name of Object.keys(fields)) {
    const answer = Object.hasOwn(value, name) ? value[name] : undefined;
    if (!isRecord(answer) || typeof answer.type !== "string" || !Object.hasOwn(answer, "value"))
      throw new ClassifierError("response", CLAIRIC_LABEL + " returned an invalid answer for " + name + ".");
    if (!jsonLike(answer.value))
      throw new ClassifierError("response", CLAIRIC_LABEL + " returned a non-JSON value for " + name + ".");
    const parsed: ExtractResult["answers"][string] = { type: answer.type, value: answer.value };
    for (const field of ANSWER_METADATA) {
      const metadata = answer[field];
      if (metadata !== undefined && jsonLike(metadata)) parsed[field] = metadata;
    }
    answers[name] = parsed;
  }
  return answers;
}

/** Cloudflare Clairic structured extraction through the configured clairic-api route. */
export async function extract(params: unknown, options: ExtractOptions): Promise<ExtractResult> {
  if (params === null || typeof params !== "object" || Array.isArray(params))
    throw new ClassifierError("input", "extract requires an object with fields and optional state/media.");
  const input = params as ExtractParams;
  if (options.signal?.aborted)
    throw new ClassifierError("aborted", "Extraction was cancelled.");
  const route = resolveModel(options.settings, undefined, options.credentialSource ?? "pi-store");
  const apiKey = route.authMode === "none" ? "" : resolveApiKey(route, options.credentialSource ?? "pi-store");
  const prepared = await prepareExtractionInput(
    input,
    route,
    options.cwd,
    options.signal,
  );
  if (options.signal?.aborted)
    throw new ClassifierError("aborted", "Extraction was cancelled.");
  if (route.api === "openrouter-extractions")
    return extractWithOpenRouter(route, prepared, apiKey, options.signal);
  if (route.api === "litellm-extraction")
    return extractWithLiteLLM(route, prepared, apiKey, options.signal);
  const payload: Record<string, unknown> = {
    model: "clairic",
    fields: prepared.fields,
  };
  if (prepared.state !== "") payload.state = prepared.state;
  if (prepared.referenceDate !== undefined) payload.reference_date = prepared.referenceDate;
  if (prepared.options !== undefined) {
    // Public callers use camelCase; Clairic's wire contract uses snake_case.
    const wireOptions: Record<string, boolean> = {};
    if (prepared.options.includeQuantiles !== undefined)
      wireOptions.include_quantiles = prepared.options.includeQuantiles;
    if (prepared.options.returnStateText !== undefined)
      wireOptions.return_state_text = prepared.options.returnStateText;
    if (Object.keys(wireOptions).length > 0) payload.options = wireOptions;
  }
  if (prepared.images.length)
    payload.images = prepared.images.map((image) => ({
      content_type: image.mimeType,
      base64: image.data,
      ...(image.rotation !== undefined ? { rotation: image.rotation } : {}),
    }));
  if (prepared.documents.length)
    payload.documents = prepared.documents.map((document) => ({
      content_type: document.mimeType,
      base64: document.data,
    }));
  const { body, requestId } = await postJson(
    route,
    "run/" + route.model,
    payload,
    apiKey,
    options.signal,
  );
  const result = unwrapCloudflare(CLAIRIC_LABEL, body);
  return finalizeExtraction(route, result, prepared, costOf(route, result.usage), requestId);
}

function costOf(route: import("./types.js").ResolvedModel, usage: unknown): ClassifierCost {
  return estimateCost(route, usage);
}

function finalizeExtraction(
  route: import("./types.js").ResolvedModel,
  result: Record<string, unknown>,
  prepared: PreparedExtractionInput,
  cost: ClassifierCost,
  requestId?: string,
  providerCost?: ExtractResult["providerCost"],
  stateText?: string,
): ExtractResult {
  if (typeof result.truncated !== "boolean")
    throw new ClassifierError("response", "Extraction did not report whether output was truncated.");
  const extracted: ExtractResult = {
    provider: route.route,
    model: route.model,
    answers: parseAnswers(result.answers, prepared.fields),
    truncated: result.truncated,
    cost,
  };
  const usage = usageFrom(result.usage);
  if (usage !== undefined) extracted.usage = usage;
  if (requestId !== undefined) extracted.requestId = requestId;
  if (providerCost !== undefined) extracted.providerCost = providerCost;
  const text = stateText ?? (prepared.options?.returnStateText && typeof result.state_text === "string" ? result.state_text : undefined);
  if (text !== undefined) extracted.stateText = text;
  if (Buffer.byteLength(JSON.stringify(extracted, null, 2)) > 40 * 1024)
    throw new ClassifierError("response", "Extraction result exceeds the 40 KiB tool output limit. Ask for fewer or smaller fields.");
  return extracted;
}

function extractionOptions(prepared: PreparedExtractionInput): Record<string, boolean> | undefined {
  if (prepared.options === undefined) return undefined;
  const wire: Record<string, boolean> = {};
  if (prepared.options.includeQuantiles !== undefined) wire.include_quantiles = prepared.options.includeQuantiles;
  if (prepared.options.returnStateText !== undefined) wire.return_state_text = prepared.options.returnStateText;
  return Object.keys(wire).length > 0 ? wire : undefined;
}

async function extractWithOpenRouter(
  route: import("./types.js").ResolvedModel,
  prepared: PreparedExtractionInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const payload: Record<string, unknown> = { model: route.model, fields: prepared.fields };
  const media = [
    ...prepared.images.map((image) => ({
      type: "image",
      format: image.mimeType === "image/png" ? "png" : image.mimeType === "image/jpeg" ? "jpg" : "webp",
      data_base64: image.data,
    })),
    ...prepared.documents.map((document) => ({ type: "document", format: "pdf", data_base64: document.data })),
  ];
  const refs = media.map((_, index) => "asset-" + index);
  let state = typeof prepared.state === "string" ? prepared.state : JSON.stringify(prepared.state);
  if (refs.length > 0 && state !== "") state = state + "\n" + refs.join(" ");
  if (state !== "") payload.state = state;
  if (refs.length > 0)
    payload.assets = Object.fromEntries(media.map((entry, index) => [refs[index], entry]));
  if (prepared.referenceDate !== undefined) payload.reference_date = prepared.referenceDate;
  const options = extractionOptions(prepared);
  if (options)
    payload.provider = { options: { cloudflare: options } };
  const { body, requestId } = await postJson(route, "alpha/extractions", payload, apiKey, signal);
  if (!isRecord(body)) throw new ClassifierError("response", "OpenRouter Extractions returned an unexpected response.");
  return finalizeExtraction(
    route,
    body,
    prepared,
    estimateCost(route, body.usage),
    requestId,
    reportedCost(body.usage),
  );
}

async function extractWithLiteLLM(
  route: import("./types.js").ResolvedModel,
  prepared: PreparedExtractionInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const payload: Record<string, unknown> = { model: route.model, fields: prepared.fields };
  if (prepared.state !== "") payload.state = prepared.state;
  if (prepared.referenceDate !== undefined) payload.reference_date = prepared.referenceDate;
  const options = extractionOptions(prepared);
  if (options) payload.options = options;
  if (prepared.images.length)
    payload.images = prepared.images.map((image) => ({ content_type: image.mimeType, base64: image.data }));
  const { body, requestId, costHeader } = await postJson(route, "extraction", payload, apiKey, signal);
  if (!isRecord(body)) throw new ClassifierError("response", "LiteLLM extraction returned an unexpected response.");
  const providerCost = costHeader ? { currency: "USD" as const, total: Number(costHeader), source: "gateway" as const } : undefined;
  return finalizeExtraction(route, body, prepared, estimateCost(route, body.usage), requestId, providerCost);
}

export { userError };
