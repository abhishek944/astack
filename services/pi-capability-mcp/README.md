# pi-capability-mcp

A private hosted HTTP MCP service that exposes Pi's image, web and classifier capabilities through one scoped endpoint. External callers make ordinary MCP POSTs; the service enqueues each call on an internal family queue and holds the HTTP response until the job finishes.

This is an Astack service. The capability logic stays in the owning packages: `@abhishek944/pi-image-gen`, `pi-web-access` and `@abhishek944/pi-classifier`. This directory owns only transport, authorization, queues, idempotency, cancellation and composition.

## Install and build

```bash
cd services/pi-capability-mcp
npm install --no-audit --no-fund
npm run typecheck
npm run build
```

The two Astack packages are local `file:` dependencies because the current local versions are newer than the published packages. `pi-web-access` is a normal dependency and provides its own `pi-web-access-mcp` process. `dist/`, `node_modules/` and local `.env` files stay untracked.

## Configuration

Copy `.env.example` to a private file outside Git and replace every placeholder. The service reads configuration only from the environment.

- `MCP_RUNTIME_TOKENS_JSON` is an array of `{ name, tokenHash, tools }` records. `tokenHash` is the lowercase SHA-256 hex digest of the bearer token. `tools` is the exact tool allowlist for that token.
- Provider keys, model routes and web provider settings belong in `MCP_IMAGE_SETTINGS_JSON`, `MCP_IMAGE_SEARCH_SETTINGS_JSON` and `MCP_CLASSIFIER_SETTINGS_JSON`, or in the environment inherited by the web MCP child. Tool arguments cannot override credentials, providers, models or endpoints. The web adapter strips the package's `provider` and `proxy` controls from both its advertised schemas and forwarded arguments.
- `MCP_JOB_WAIT_TIMEOUT_MS`, `MCP_HTTP_REQUEST_TIMEOUT_MS` and `MCP_EXPECTED_CLIENT_TIMEOUT_MS` are operator-owned. Startup fails unless HTTP timeout is greater than job wait and the expected Pi client timeout is at least the HTTP timeout. Pi's `mcp.json` `timeout` is in seconds and defaults to 60; set it explicitly to match the deployed path.
- `MCP_COMPLETION_SETTINGS_JSON` is optional. When present it enables the `model_complete` tool with a server-owned provider, base URL, model route, API-key environment variable and cost metadata. Callers may check the frozen model with `expectedModel` but cannot route to another model or endpoint.
- `MCP_REDIS_URL` points at the BullMQ Redis instance. Idempotency records have no application-defined TTL; queue and key retention are an operator decision.
- `MCP_WORKING_DIRECTORY` is the only directory used for generated or downloaded files. Caller-supplied `outputDir` values are discarded before an adapter runs. Duplicate runtime token names are rejected at startup.

Never put a raw token or provider key in a command line, repository file or log.

## Run

```bash
node --env-file=/absolute/private/path/pi-capability-mcp.env dist/service.js
```

`GET /health` is unauthenticated. `POST /` and `POST /mcp` use `Authorization: Bearer <runtime-token>`. One stateful MCP session is created per Pi connection and authenticated on every request; `DELETE /mcp` closes a session. There is no OAuth flow or job-receipt API.

Configure Pi with one server and keep tool definitions out of the model context:

```json
{
  "mcpServers": {
    "capabilities": {
      "url": "http://127.0.0.1:4317/mcp",
      "headers": { "Authorization": "Bearer ${CAPABILITY_RUNTIME_TOKEN}" },
      "timeout": 130,
      "exposure": "codemode",
      "description": "Server-held image, web and classifier capabilities"
    }
  }
}
```

`deferred` is also supported. Pi's `codemode` and `tool_search` can discover the scoped tools with `describeNamespace("mcp__capabilities")` and `searchTools()` without putting every schema in the model prompt. `tools/list` returns only the tools allowed by the token, but `tools/call` checks the same allowlist again because discovery is not authorization.

## Tool contract

Paid tools require an `idempotencyKey` argument. Reusing the same key with the same tool and arguments returns the first job's result; reusing it with different arguments is rejected. BullMQ custom job IDs deduplicate concurrent enqueues. If a retained claim outlives its job, the call fails closed instead of dispatching paid work again. Workers use one attempt and one permitted start (`maxStartedAttempts: 1`), so a possibly paid call is not replayed after a stall.

The service owns three BullMQ queues: `pi-capability-mcp-image`, `pi-capability-mcp-web` and `pi-capability-mcp-classifier`. A slow image job does not occupy a web or classifier worker. No product budget, per-account quota, global concurrency cap or external polling endpoint is added. Provider and runtime limits remain owned by the capability packages and upstream providers.

Cancellation follows the MCP request signal. The installed MCP SDK correlates `notifications/cancelled` with the original request inside one server session, so the service uses its session transport rather than a fresh stateless server per POST. This is an internal transport detail; it adds no external polling endpoint. When every caller waiting on the same job cancels, the adapter receives an abort signal, including for a job still queued behind another worker. Cancellation is a stop request, not a refund; upstream providers may still bill work already dispatched. The configured deadline covers idempotency claims, enqueue and held-response completion; exceeding it returns an MCP error, aborts the in-process wait group and ends the held response.

`image_search` and `image_search_compare` call the independent `@abhishek944/pi-image-gen/search` library with separate server-held `MCP_IMAGE_SEARCH_SETTINGS_JSON`. They find and validate existing images, return the library's provider, source and license metadata, and never invoke image generation. HighSKU's tenant-scoped enrichment path remains a separate consumer; this service does not replace or re-scope it.

The optional `sprite_generate` tool is exposed only when server-held image settings enable sprite generation. It uses the same package-owned schema and pipeline as the native Pi extension. `model_complete` is exposed only when completion settings are configured; it returns text, measured usage, model identity and stop reason, and accepts only prompt messages plus verified attribution. Image-search arguments may include `expectedProvider`, which is a fail-closed check, not a routing override. Other Pi-only or helper tools such as computer use are not exposed.

The current topology runs the HTTP listener and the workers in one process, so abort propagation uses in-process wait groups. A multi-replica deployment needs a shared cancellation channel before replicas can safely share the same Redis and idempotency keys. `model_complete` is routed on the image family queue because it shares the image/vision adapter lifecycle; no separate product quota or budget is added.

## Non-goals

No OAuth, no per-tier endpoints, no external job receipts or polling, no hard spending caps, no provider-specific queue configuration and no production deployment are included. Unit tests are intentionally not added.
