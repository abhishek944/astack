# pi-decisions

A Pi 1.4 ESM extension for fixed single-choice, multiple-choice and review pages. The AI supplies content directly; the extension renders the page, handles media, routes delivery from configuration, and returns the user's feedback through **SubmitQuestion** and **WaitForAnswer**.

## Install and configure

Build this checkout with `npm install --ignore-scripts && npm run build`, then load it with `pi -e /absolute/path/to/pi-decisions`. For a persistent local installation use `pi install /absolute/path/to/pi-decisions`, then `/reload` or restart Pi.

Configure delivery in global `~/.pi/agent/settings.json` or normal Pi project settings:

```json
{
  "pi-decisions": { "backend": "local" }
}
```

`local` is the default and serves a loopback-only page. Set the configuration value to `here.now` for account-owned hosted delivery. Backend selection is not a tool argument. A question's delivery is pinned when first submitted; configuration changes affect new questions. There is no silent local/cloud fallback.

**Privacy:** hosted links and their media are public to anyone with the URL. Only submit material approved for public sharing. Anyone with the link can submit a response; this is not authenticated voting or approval for consequential actions. Credentials, private state, source paths and answer archives are not published. Hosted Sites are not automatically deleted.

here.now credentials are read privately at runtime from `HERENOW_API_KEY` or `~/.herenow/credentials`. Credentials are never embedded in the page or passed in command arguments. Anonymous publication is not used because feedback uses account-owned Site Data.

## SubmitQuestion

```ts
{
  questionId: string;
  mode: "single" | "multiple" | "review";
  question: string;
  content?: ContentBlock[];
  options?: { id: string; label: string; content?: ContentBlock[] }[];
  recommended?: string;
  label?: string;
}
```

This is the only supported input shape. No directory, task folder, active task lookup, options file, HTML or CSS is needed. Media paths must be **complete absolute filesystem paths** to regular files; sources can be outside the project. Only explicitly referenced and validated media is copied into the public bundle.

| Mode | Controls |
| --- | --- |
| `single` | Radio option cards, Clear selection, comments box, Send response |
| `multiple` | Checkbox option cards, Clear selection, comments box, Send response |
| `review` | Review textbox and Send review; no option cards or Clear selection |

Choice modes require a nonempty `options` array with unique IDs and nonempty labels. `recommended`, if supplied, is an option ID. Review mode omits both `options` and `recommended`. Clear selection preserves written comments. A choice or nonblank comments is sufficient in choice modes; review requires nonblank comments. Six cards fit two desktop rows of three, with two/one columns on smaller screens; six is not a quota. Media controls do not select the surrounding option.

`questionId` is a safe filename component, unique within the current session/project. Identical content reuses its delivery. Changing text, options, media bytes or source references requires a fresh ID, so an old browser tab cannot answer a replacement question. `label` optionally sets the page display title.

### Shared content blocks

Question-level and option-level `content` are ordered arrays of the same blocks:

```ts
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; path: string; alt: string; caption?: string }
  | { type: "video"; path: string; caption?: string }
  | { type: "mermaid"; code: string; caption?: string };
```

Text is escaped plain text. Images support PNG/JPEG/GIF/WebP and an accessible expansion dialog. Video supports MP4/WebM with native controls, seeking and download. Prefer H.264 MP4, optionally with AAC audio, for broad browser support. Container headers and types are checked, not complete decoding or codec compatibility. Videos are not transcoded. Mermaid runs in an isolated script-enabled iframe without same-origin privileges and loads Mermaid 11 from jsDelivr, so diagram rendering requires internet access. There is no arbitrary HTML block.

The extension owns spacing, responsive columns, controls and player markup. Blocks can be combined freely. The human response is text and selected IDs, not uploaded media.

### Choice example

```js
SubmitQuestion({
  questionId: "navigation-choice",
  mode: "single", // or "multiple"
  question: "Which navigation should we use?",
  content: [{ type: "text", text: "Compare discoverability and screen space." }],
  options: [
    { id: "A", label: "Sidebar", content: [
      { type: "image", path: "/absolute/path/sidebar.png", alt: "Sidebar navigation" }
    ] },
    { id: "B", label: "Top navigation", content: [
      { type: "video", path: "/absolute/path/top-navigation.mp4" },
      { type: "mermaid", code: "flowchart LR\nHome --> Settings" }
    ] }
  ],
  recommended: "A"
})
```

### Review example

```js
SubmitQuestion({
  questionId: "checkout-review",
  mode: "review",
  question: "Please review the checkout flow.",
  content: [
    { type: "text", text: "Check validation and confirmation." },
    { type: "video", path: "/absolute/path/checkout.mp4", caption: "Checkout recording" }
  ]
})
```

Submission returns `{questionId, backend, url, responsePath, statePath, status, public, warnings}`. Share the returned URL, then wait for the answer.

## WaitForAnswer

```js
WaitForAnswer({ questionId: "checkout-review" })
```

Only `questionId` is accepted. An archived answer returns immediately. Otherwise the tool starts/reuses one packaged watcher through pi-loop-monitor's MonitorCreate and returns `waiting` with its monitor ID. **Yield until the watcher wakes Pi; do not repeatedly poll using model turns.** The watcher archives a valid response before success. A monitor exit, timeout, cancellation or error is not a human answer. MonitorCreate/MonitorList must be available through pi-loop-monitor.

The normalized answer contains:

```ts
{
  questionId: string;
  revision: string;
  mode: "single" | "multiple" | "review";
  selectedIds: string[];
  selectedLabels: string[];
  submissionType: "selection" | "comments-only";
  response: string;
  timestamp: string;
  sessionId: string;
  backend: "local" | "here.now";
  recordId: string | null;
}
```

Selections and labels are reconstructed in displayed option order from trusted question data. Comments-only feedback has empty selection arrays and nonblank `response`. The owner validates question/revision identity, unique known IDs, mode and response text. The first validated archived answer wins. Domain-specific screenshot provenance or implementation contracts belong to the calling workflow and are not tool parameters or browser-supplied authority.

## Internal storage and lifecycle

State, `response.json` and the explicit public bundle live internally under `.pi/decisions/<sessionId>/<questionId>/` in the current project. This storage is private, session-scoped and independent of tasks or media source locations. Media is published under content-hashed filenames. Public presentation containing local filesystem paths is rejected; keep source paths only in media `path` fields.

Only state format 2 is supported. Earlier saved formats are not loaded or migrated. Existing files are never deleted or overwritten to upgrade them; resubmit outstanding questions using fresh IDs. On reload/reopen, supported pending questions prompt the agent to consume/re-arm their watchers. Unavailable saved questions are reported for resubmission. A stopped local server can be restarted by repeating an identical submission.

Classic monitors stop on reload, session switch or shutdown. The extension shuts down local delivery children it owns. Keep Pi running while waiting; stopped machines cannot be woken automatically. CLI users must stop unanswered local deliveries they no longer need. There is no separate recovery manager.

Local delivery binds an OS-assigned port on `127.0.0.1`, serves only explicit generated bundle files, supports single video byte ranges, and requires exact Origin plus a private per-question capability for submission/stop. It never serves the project or a media source directory.

here.now uses create → presigned PUT uploads → finalize, then authenticated owner Site Data reads with documented pagination. Browser inserts encode `selected_ids` as a JSON-array string; the adapter strictly decodes it before shared validation. Answer collection is not a new feedback service. Failed/uncertain publishes fail visibly and are not blindly replayed. Provider warnings retain the live URL but must be inspected before collecting answers. Diagnostics redact credentials rather than exposing raw provider response bodies.

## Limits

The existing mandatory here.now answer record boundary is **16 KB (16,384 UTF-8 bytes)** including the JSON envelope. Oversized feedback is rejected, never truncated. Provider publish/collection quotas and rate limits remain authoritative; owner reads honor Retry-After on rate limiting. See [here.now documentation](https://here.now/docs) and [OpenAPI](https://here.now/openapi.json).

No application option/block/media-size cap is imposed. Asset handling currently uses memory buffers, so actual machine memory/storage and provider upload quotas apply.

## Model-free CLI

The CLI shares the same direct request/core and requires no model call or Pi runtime import:

```bash
node /absolute/path/to/pi-decisions/dist/cli.js submit \
  --request /absolute/request.json \
  --session-id CURRENT_SESSION_ID \
  --cwd /absolute/project \
  --backend local

node /absolute/path/to/pi-decisions/dist/cli.js check --state /absolute/state.json
node /absolute/path/to/pi-decisions/dist/cli.js watch --state /absolute/state.json
node /absolute/path/to/pi-decisions/dist/cli.js stop --state /absolute/state.json
```

The request JSON contains exactly the direct SubmitQuestion fields above. `--backend` is standalone CLI configuration (default local), not a property of that request. Use `--backend here.now` for configured hosted CLI delivery. `check` returns waiting or the normalized answer. `watch` remains alive without a waiting deadline and archives before success. `stop` closes the owned local server; it does not delete hosted Sites or answers. Private credentials, question text and capabilities are not CLI arguments or submission output.

## Development verification

```bash
npm run typecheck
npm run build
npm run lint
npm pack --dry-run
```

No unit tests or test-only dependencies are included. Model-free local HTTP integration is suitable for verification. Live browser testing and real here.now publication require explicit authorization and are separate from local build checks.
