import { ClassifierError, type ResolvedModel } from "./types.js";

/** Optional bounded parser for provider error envelopes; receives the active key so echoed credentials can be omitted. */
export type JsonErrorDetail = (status: number, body: unknown, apiKey: string) => string | undefined;

/** Optional sanitizer for a validated response-header request ID; omitted values fall back to provider-body IDs. */
export type JsonRequestIdDetail = (value: string, apiKey: string) => string | undefined;

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new ClassifierError("response", "Classifier returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new ClassifierError("response", "Classifier response exceeds 1 MiB.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function postJson(
  route: ResolvedModel,
  path: string,
  body: unknown,
  apiKey: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
  errorDetail?: JsonErrorDetail,
  requestIdDetail?: JsonRequestIdDetail,
): Promise<{ body: unknown; requestId?: string; costHeader?: string }> {
  if (signal?.aborted)
    throw new ClassifierError("aborted", "Classification was cancelled.");
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > 20 * 1024 * 1024)
    throw new ClassifierError(
      "input",
      "Encoded classifier request exceeds 20 MiB.",
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), route.requestTimeoutMs);
  try {
    const headers = new Headers(route.headers);
    for (const [key, value] of Object.entries(extraHeaders ?? {}))
      headers.set(key, value);
    if (route.authMode === "none") {
      // Local runtimes are reached over loopback without an API key.
    } else if (route.authMode === "subscription-key") {
      headers.set("api-subscription-key", apiKey);
    } else if (route.authMode === "google-api-key") {
      headers.set("x-goog-api-key", apiKey);
    } else if (route.authMode === "parallel-api-key") {
      headers.set("x-api-key", apiKey);
    } else if (route.authMode === "api-key") {
      headers.set("api-key", apiKey);
    } else {
      headers.set("authorization", "Bearer " + apiKey);
    }
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json");
    const response = await fetch(route.baseUrl + "/" + path, {
      method: "POST",
      headers,
      body: encoded,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      let detail: string | undefined;
      if (errorDetail) {
        try {
          const raw = await readBoundedText(response);
          if (raw) detail = errorDetail(response.status, JSON.parse(raw), apiKey);
        } catch {
          // Keep the generic error when an error body is absent, oversized or not JSON.
        }
      } else {
        await response.body?.cancel();
      }
      throw new ClassifierError(
        "http",
        "Classifier request failed (HTTP " +
          response.status +
          "). Check credentials, model, limits and provider availability." +
          (detail ? " " + detail : ""),
        response.status,
      );
    }
    const raw = await readBoundedText(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ClassifierError(
        "response",
        "Classifier returned invalid JSON.",
      );
    }
    const result: { body: unknown; requestId?: string; costHeader?: string } = { body: parsed };
    const id =
      response.headers.get("x-request-id") ??
      response.headers.get("request-id");
    if (id && /^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) {
      const safeId = requestIdDetail ? requestIdDetail(id, apiKey) : id;
      if (safeId !== undefined) result.requestId = safeId;
    }
    const cost = response.headers.get("x-litellm-response-cost");
    if (cost && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cost)) result.costHeader = cost;
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw new ClassifierError(
        signal?.aborted ? "aborted" : "timeout",
        signal?.aborted
          ? "Classification was cancelled."
          : "Classifier request timed out. This request was not retried.",
      );
    if (error instanceof ClassifierError) throw error;
    throw new ClassifierError(
      "network",
      "Classifier service could not be reached. This request was not retried.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
