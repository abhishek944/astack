import { resolveApiKey, type CredentialSource } from "./auth.js";
import { resolveModel } from "./config.js";
import { estimateCost, tokenCount } from "./cost.js";
import { postJson } from "./http.js";
import { prepareExtractionInput } from "./inputs.js";
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
  "span", "spans", "property_spans", "span_method", "grounding_method", "printed_value", "normalization_method", "failure_reason", "source",
  "unit", "mean", "median", "p10", "p90", "p_below", "p_above", "quantiles", "steps",
] as const;

function usageFrom(value: unknown): ExtractResult["usage"] {
  if (!isRecord(value)) return undefined;
  const input = tokenCount(value.input_tokens);
  const output = tokenCount(value.output_tokens);
  if (input === undefined || output === undefined) return undefined;
  return { inputTokens: input, outputTokens: output, totalTokens: input + output };
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
  const prepared = await prepareExtractionInput(
    input,
    route,
    options.cwd,
    options.signal,
  );
  if (options.signal?.aborted)
    throw new ClassifierError("aborted", "Extraction was cancelled.");
  const apiKey = resolveApiKey(route, options.credentialSource ?? "pi-store");
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
  if (typeof result.truncated !== "boolean")
    throw new ClassifierError("response", CLAIRIC_LABEL + " did not report whether output was truncated.");
  const cost: ClassifierCost = estimateCost(route, result.usage);
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
  if (prepared.options?.returnStateText && typeof result.state_text === "string")
    extracted.stateText = result.state_text;
  if (Buffer.byteLength(JSON.stringify(extracted, null, 2)) > 40 * 1024)
    throw new ClassifierError("response", "Clairic result exceeds the 40 KiB tool output limit. Ask for fewer or smaller fields.");
  return extracted;
}

export { userError };
