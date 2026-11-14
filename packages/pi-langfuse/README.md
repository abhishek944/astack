# @abhishek944/pi-langfuse

Tracing-only Pi extension and SDK factory that records what a Pi session can observe — agent runs,
model generations, tool calls and compactions — to [Langfuse](https://langfuse.com).

The package registers **no tools**, no commands and no providers. It never changes prompts, provider
payloads, tool results or conversation messages. Every handler is observation-only.

## What it records

| Pi event | Langfuse observation |
|---|---|
| `before_agent_start` → `agent_settled` | Root `pi.agent` span with model/provider, outcome, counts, duration |
| `message_start` / `message_update` / `message_end` (assistant) | Generation span with model, response model/id, stop reason, usage, cost, cache splits, duration and time to first token |
| `tool_execution_start` / `tool_execution_end` | Tool span with name, call id, parent call id (nested tools), duration and error flag |
| `session_before_compact` / `session_compact` / `session_compact_failed` | Compaction span with reason, retry flag, tokens before and summarizer usage; works for session-level compactions outside an agent run without inventing an agent span |

Model turns are traced with `message_start`/`message_end`, not provider hooks. This works with custom
or native Pi providers that never emit `before_provider_request`, `after_provider_response` or
`provider_stream_event` and with SDK hosts that create a session per run and dispose it without
emitting `session_start`/`session_shutdown`.

Final run status comes only from `turn_end` and `agent_settled`. Individual tool or generation errors
keep their own span level and are counted in `toolErrors` / `generationErrors` metadata; a retry that
recovers does not turn the root span into an error.

## Privacy defaults

Default capture is **metadata only**:

- no prompts, system prompts, message text, thinking, tool arguments, tool results, images, compaction
  summaries or raw error text;
- only identifiers, names, counts, model/provider, stop reason, usage, cost, cache splits, timing,
  outcome and flags.

Built-in sanitization always runs, even with full capture:

- configured Langfuse key values and Langfuse-shaped key tokens are replaced with `[redacted]` in
  payloads, labels and metadata values;
- image parts are replaced by a marker — no bytes, data URIs or media uploads (media upload is also
  disabled on the span processor);
- provider signature blobs are removed.

`capture: "full"` is a separate, explicit opt-in. In full mode the same sanitization runs, then the
optional `redact` hook runs on every payload and error string, and the hook's output is sanitized
again. If the hook throws, returns `undefined`, or returns a promise/thenable, the payload is dropped;
raw data is never used as a fallback, and asynchronous redaction is intentionally unsupported.
`LangfuseRunContext` is public trace metadata by contract: do not put prompts, tool bodies or secrets
in it.

Langfuse keys are server configuration. They are never written to span attributes, metadata,
diagnostics, errors or `LangfuseRunContext`. The environment and release labels passed to the exporter
are scrubbed with the same boundary, and explicit SDK configuration is normalized to the supported
cloud default URL plus explicit empty labels, so the SDK never falls back to ambient destination or
label variables.

## Install and configure as a normal Pi extension

```bash
pi install npm:@abhishek944/pi-langfuse
```

Set server-side environment variables for the Pi process:

| Variable | Meaning |
|---|---|
| `LANGFUSE_PUBLIC_KEY` | Required |
| `LANGFUSE_SECRET_KEY` | Required |
| `LANGFUSE_ENABLED` | `false`, `0`, `no` or `off` disables tracing even when keys are set |
| `LANGFUSE_BASE_URL` | Optional Langfuse or self-hosted URL |
| `LANGFUSE_TRACING_ENVIRONMENT` | Optional environment tag |
| `LANGFUSE_RELEASE` | Optional release tag |
| `PI_LANGFUSE_CAPTURE` | `metadata` (default) or `full` |

The extension is enabled by default once both keys are configured. With a missing key it is inert:
no exporter, no sockets, no per-event work. Unknown capture values fall back to `metadata`.
Export failures and handler failures never break the agent.

When the extension is loaded but tracing later fails to start, one fixed diagnostic line is written to
stderr and the rest of the session runs normally.

## Use as an SDK factory

Hosts that create sessions themselves (for example a Node HTTP service using
`createAgentSession()` with `noExtensions: true` and inline extension factories) can share one
exporter across many concurrent sessions and inject per-run context:

```ts
import { DefaultResourceLoader, createAgentSession } from "@earendil-works/pi-coding-agent";
import { createLangfuseTracing } from "@abhishek944/pi-langfuse";

// One process-scoped exporter. Inert when keys are absent.
const tracing = createLangfuseTracing();

const langfuse = tracing.extension({
  sessionId: request.runId,          // optional: group traces for one chat/run
  traceName: "chat-run",             // optional
  tags: ["chat-host"],               // optional
  metadata: { runId: request.runId },// optional public metadata
});

const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  noExtensions: true,
  extensionFactories: [langfuse],
});

// ... create the session, prompt it, dispose it ...

await tracing.flush();   // optional: deliver pending spans
await tracing.dispose(); // idempotent: flush + shut down the shared provider
```

SDK options:

| Option | Meaning |
|---|---|
| `enabled` | `false` makes the instance explicitly inert without reading or changing the environment |
| `config` | Explicit `LangfuseConfig`. When supplied, ambient environment keys are never read |
| `context` | Default `LangfuseRunContext` for sessions from this instance; `.extension(context)` can override it |
| `onDiagnostic` | Receives safe `{ code, message }` diagnostics; default writes one line to stderr |

`LangfuseConfig`:

```ts
{
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
  environment?: string;
  release?: string;
  capture?: "metadata" | "full";
  redact?: (value, { stage, runId }) => unknown;
}
```

### Lifecycle ownership

- One `LangfuseTracing` instance owns one private tracer provider and Langfuse span processor. It never
  calls `setLangfuseTracerProvider` and never touches the global OpenTelemetry provider.
- Each `.extension()` factory gets its own per-session recorder; concurrent sessions cannot share or
  cross-parent spans. Spans use explicit parent span contexts.
- `agent_settled` ends the run span and starts the SDK's `forceFlush()` without awaiting it in the Pi
  event handler. The batch processor remains the delivery owner.
- `session_shutdown` finalizes an open run only. It never awaits network work and never shuts the
  shared provider down.
- The default Pi extension owns its tracer instance and triggers `dispose()` (fire-and-forget) on
  `session_shutdown` so exporter timers do not outlive the session.
- `flush()` and `dispose()` use the supported SDK lifecycle with the SDK's own timeout. The caller
  decides when to await them. `dispose()` is idempotent, memoizes the in-flight shutdown, and is the
  only place the shared provider is shut down; later `dispose()` or `flush()` calls share its
  completion and no new runtime is created afterward. These explicit public APIs propagate normal SDK
  lifecycle failures to their awaiting caller rather than silently swallowing them; the automatic
  settlement and shutdown paths catch their own fire-and-forget failures.

Standalone Pi-AI calls can use the metadata-only [generation adapter](STANDALONE.md).
Do not attach that adapter to model work already observed by the session extension.

## What this cannot cover

- Provider HTTP request/response bodies, status, headers and retries; a custom provider that does not
  call Pi's provider hooks never exposes them.
- Remote tool bodies, speech/image generations or app-side accounting. Standalone Pi-AI
  generations require the explicit generation adapter; they are not discovered automatically.
- User, chat or operation identity that the host does not pass in `LangfuseRunContext`.
- A compaction cancelled before success/failure has no cancel event; its open span is ended as
  incomplete at the next compaction or at session shutdown. A session-level compaction is its own
  trace with the same session context, not a fabricated agent run.
- Langfuse remains analytics/debugging data, not an accounting authority.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm pack --dry-run
```

The package has its own lockfile and build. No unit tests are included; verification is the package
lifecycle above plus type compatibility with the supported Pi host versions.

## License

MIT
