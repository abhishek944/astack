# pi-embeddings

Config-driven text embeddings for Pi and MCP. The package owns provider configuration, credentials, request construction, preparation, mandatory batching, transport, local runtime lifecycle, validation, normalization, fallback, explicit comparison and usage accounting. Callers own storage and compatibility decisions.

## Public surfaces

- `@abhishek944/pi-embeddings` — typed library factory and derived public types. No Pi runtime imports.
- `@abhishek944/pi-embeddings/schemas` — authoritative TypeBox schemas for settings, requests, outcomes, attempts, results, context, descriptors and describe output.
- `@abhishek944/pi-embeddings/extension` — Pi extension registered in `pi.extensions`.
- `@abhishek944/pi-embeddings/mcp` — `createEmbeddingsMcpServer`; transport-neutral, no Pi runtime dependency.
- `pi-embeddings-mcp` — stdio binary. stdout carries JSON-RPC only; diagnostics go to stderr.

MCP tools are `embed`, `embed_compare` and `embeddings_describe`. Vectors are returned in `structuredContent.result`; the text content is a short summary. Pi commands are `/embeddings list`, `doctor`, `reload`, `use <provider> <model>` and `compare <text>`.

```ts
import { createEmbeddingsRuntime } from '@abhishek944/pi-embeddings';

const runtime = createEmbeddingsRuntime({ settings, cwd });
const described = runtime.describe();
const result = await runtime.embed({ inputs: ['Attribute: value'] }, { signal, context });
await runtime.close();
```

There are no per-call provider, model, endpoint, credential or expected-space parameters. `describe` is provider-free information, not a reservation or a caller storage policy.

## Settings

Settings live under the `pi-embeddings` namespace. Pi loading follows global < agent config < explicitly trusted project; environment interpolation applies only to the global and agent layers. A standalone CLI never reads project settings. A service host passes operator-approved settings explicitly.

```json
{
  "pi-embeddings": {
    "version": 1,
    "default": { "provider": "local", "model": "embeddinggemma-2" },
    "fallback": [{ "provider": "openai", "model": "text-embedding-3-small" }],
    "compare": [{ "provider": "sarvam", "model": "embeddinggemma-2" }],
    "providers": {
      "local": {
        "executable": "/operator-supplied/runtime/llama-server",
        "modelPath": "/operator-supplied/model/embeddinggemma-2-Q8_0.gguf"
      },
      "openai": { "apiKey": "${OPENAI_API_KEY}" },
      "sarvam": { "apiKey": "${SARVAM_API_KEY}" },
      "gateway": {
        "baseUrl": "https://operator-gateway.example",
        "apiKey": "${LITELLM_INFERENCE_KEY}",
        "model": "openai/text-embedding-3-small",
        "stage": "dev"
      }
    }
  }
}
```

Provider IDs are route identifiers: `local`, `openai`, `sarvam` and `gateway`. Only the declared model pairs are valid. Omitted or empty `fallback` and `compare` lists are inactive. No route is activated by a schema annotation, a present key or existing model files.

Ordinary calls use the configured default, then configured fallback in order, advancing only for typed missing credentials or HTTP 401/404/429. There is no fallback for 403, refusal, 400/422, invalid input or vector, malformed response, ambiguous network failure, timeout, 5xx or cancellation. Successful inputs are never replayed on another route. Explicit comparison runs exactly the configured compare list in order, without fallback, ranking or default mutation.

## Routes and batching

- `local`: pinned EmbeddingGemma 2 Q8 CPU, 768 dimensions. The operator supplies assets; the package verifies the exact model hash and runtime commit, starts only its own loopback child, uses CPU-only flags, shares it across acquisitions and closes it once. No download, install, global binary search, warmup or foreign listener takeover.
- `openai`: `text-embedding-3-small`, 1536 dimensions. Complete prefixed strings are submitted; `cl100k_base` counts the exact prepared string and a local encode/decode round-trip is checked. Mandatory limits are 8192 tokens per input, 2048 inputs and 300000 tokens per request.
- `sarvam`: hosted `embeddinggemma-2`, 768 dimensions. Strings are submitted and the service enforces its documented per-string token estimate; no local count or borrowed aggregate cap is invented.
- `gateway`: the declared OpenAI recipe through LiteLLM. Only `text-embedding-3-small` and `openai/text-embedding-3-small` aliases are supported. One request carries generic host attribution as `x-litellm-customer-id` and `x-litellm-tags`; missing or unsafe attribution refuses before inference.

The package supplies the document prefix `title: none | text: ` exactly once and normalizes vectors with the recorded stable L2 identity. It never summarizes, trims, chunks or truncates input text.

## MCP attribution

Hosts pass generic attribution in `params._meta` under `pi-embeddings/context`:

```json
{ "pi-embeddings/context": { "endUser": "verified-owner", "tags": ["stage:dev", "base:..."] } }
```

This is attribution only. The authenticated server-to-server boundary supplies caller authority; metadata is never proof of ownership and cannot include provider, model, endpoint or credential overrides.

## Generating spaces

Descriptors record canonical provider, model, known revision or explicit null, quantization/runtime/pooling provenance, dimensions, preparation prefix and normalization identity. Local and Sarvam remain distinct at 768 dimensions. Direct OpenAI and the declared gateway alias share the OpenAI descriptor only when the effective text, preparation and normalization remain identical. API keys, service URLs and gateway aliases are route metadata, not implicit new spaces.

Existing stored vector documents are preserved. Package outcome descriptors allow callers to compare complete identity before persistence; a successful inference from an incompatible space is still reported truthfully.

## Limits

No application capacity caps are added. Provider request limits above are mandatory documented constraints. Sarvam and local publish no aggregate request cap, so none is invented. No cost estimator or pricing table is included; unknown provider accounting is reported as null.

Live cloud or local inference, service deployment and shared database writes are not performed by this package.
