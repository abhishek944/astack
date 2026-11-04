# pi-research

A [Pi](https://pi.dev) package for read-only research work. It bundles one-shot and persistent `/ask` read-only runs, the reusable read-only guard that other extensions can acquire, a settings-only native Durable extension, and the `research`, `read-flows`, and `design-council` skills.

The package was previously published as `@abhishek944/pi-ask`. The guard protocol keeps its original `pi-ask:guard:*` names so existing callers and stored Durable state continue to work; see [Reusable guard](#reusable-guard).

## Install

From a local checkout:

```sh
pi install /absolute/path/to/astack/packages/pi-research
```

After it is published, install from npm:

```sh
pi install npm:@abhishek944/pi-research
```

Restart Pi after installing, or run `/reload` in an existing session.

## `/ask`

`/ask` narrows Pi's active tools to a read-only policy for research work. It adds no Ask Mode instructions to the conversation. Two forms exist: a one-shot answer and a session-scoped mode.

Both forms keep only the approved read-only tools that are already active:

- `read`
- `grep`
- `find`
- `ls`
- `web_enable`
- `web_search`
- `source_check`
- `fetch_content`
- `get_search_content`
- `MonitorList`
- `LoopList`
- `WorkList`
- `TodoList`

`web_enable` can activate the configured web lookup tools during the answer. Allowlisting a tool does not install or enable a disabled extension.

Shell, file-changing, and generation tools such as `bash`, `edit`, `write`, `image_generate`, and `sprite_generate` are unavailable. Work, todo, loop, and monitor mutations and delegation tools are unavailable too; only their list and status tools are allowed. Every tool call is checked again immediately before execution, and any tool outside the policy is blocked.

### `/ask <question>`

```text
/ask What does this function return?
```

The question runs with only the approved read-only tools that were already active. When the answer settles, Pi restores the previous tool list. If startup fails before an answer begins, the next idle prompt automatically restores that list before it is processed.

### `/ask on`, `/ask off`, `/ask status`

```text
/ask on
/ask off
/ask status
```

- `/ask on` captures the active tools once, removes everything outside the read-only policy, and keeps that restriction for ordinary prompts until `/ask off`. The footer shows `Ask · read-only`. It refuses to turn on when another extension owns the current restricted run or when no allowlisted tool is active, so the mode never starts with an empty tool set. Running it again while the mode is on changes nothing.
- `/ask off` restores exactly the tool list captured at `/ask on` and clears the indicator. Running it while the mode is already off changes nothing.
- `/ask status` reports whether Ask is off, answering one question, or on as a persistent mode, plus which tools are active now.
- `/ask on` and `/ask off` wait for the current answer to finish, so a run never changes its own restriction halfway through.
- The mode lives only in memory for the current session. `/reload`, `/new`, `/resume`, `/fork`, or process exit ends it, and a previous session's tool list is never applied to another session.
- Restrictions from other extensions remain authoritative: their per-call checks stay active, and a participating extension can use the guard's probe and release events to defer its own restore and re-assert after Ask restores the captured list.

### `/ask tools`

Run `/ask tools` for a local capability report. It starts no model turn and changes no tools. The report labels itself a **preview** when Ask is not active, `persistent read-only mode` while `/ask on` is in effect, and lists the actual effective tools while an Ask answer is running. It separates allowlisted tools that are active, allowlisted tools that are registered in Pi but inactive, and allowlisted names that are not registered at all; a missing name does not tell the package why it is missing. If another extension owns the current restricted run, the report says so instead of presenting that run's tools as Ask's policy.

`/ask tools` must be typed exactly; other text after `/ask` remains a question. `/ask on`, `/ask off`, and `/ask status` are the only other reserved arguments; everything else after `/ask` is a question.

## Reusable guard

Other Pi extensions can request the same guard through Pi's shared event bus. The guard narrows the current tool set, checks every tool call again immediately before execution, supports exact top-level input constraints, and restores the previous tools when a guarded run settles, when the owner releases it explicitly, and at session shutdown.

The event names keep the original `pi-ask:` namespace because they are the protocol identifier consumed by other packages, including read-only `pi-loop-monitor` loops. Protocol version is `1`.

```ts
import type { PiAskGuardAcquireRequest } from "@abhishek944/pi-research/guard";

const request: PiAskGuardAcquireRequest = {
  ownerId: "my-extension:restricted-run",
  allowedTools: [
    "read",
    "grep",
    { name: "my_status_tool", equals: { id: "expected-id" } },
  ],
  context: "This run is read-only.",
  startsRun: true,
};
pi.events.emit("pi-ask:guard:acquire", request);
if (request.response?.status !== "active" || !request.response.acquisitionToken) {
  // Fail closed: do not start the unrestricted agent run.
}

// If startup fails before the run begins, release with the exact returned token:
function cancelBeforeStart() {
  pi.events.emit("pi-ask:guard:release", {
    ownerId: request.ownerId,
    acquisitionToken: request.response!.acquisitionToken!,
  });
}
```

Built-in tool names are accepted only when `pi.getAllTools()` reports Pi's matching built-in provenance, so an extension cannot replace `read` and inherit permission by name. Rules for extension tools can add `sourceInfo: { source, path }` when the caller depends on one exact implementation; the guard verifies that metadata before activation.

Only one restricted run can own the guard at a time. Callers must require the synchronous `active` response before starting work. Pi must be idle before a caller acquires with `startsRun: true` and immediately invokes `pi.sendMessage(..., { triggerTurn: true })`; this lets the guard associate restoration with that complete run rather than with retry-level starts.

A caller may add `persistent: true` to keep the restriction after its runs settle until it releases the guard explicitly. A persistent owner keeps the capture from the moment it acquired, and another caller that needs the guard receives `busy` while it is active, so its work waits for the release.

Owners that pass the optional `sessionId` get a session-scoped capture: a release from a different session drops the stale capture instead of applying another session's tool list.

Extensions that start unguarded custom-message runs during another run's settlement should emit `pi-ask:guard:run-start` immediately before `pi.sendMessage`. This keeps complete-run ordering intact for a later guarded wake. The event is only a lifecycle marker and does not activate restrictions. In ordinary agent runs, restoration is automatic; `pi-ask:guard:release` is available for a caller that must cancel before the agent starts. The guard emits `pi-ask:guard:released` after restoring the captured tool list, so waiting clients can resume without polling. `pi-ask:guard:probe` reports availability, protocol version, and whether any restricted run is active.

The guard module is exported as `@abhishek944/pi-research/guard`. The package's extension must also be loaded so its shared-event listeners are registered. `createPiAskGuard` exposes `isActive(ownerId?)` and `isPersistent(ownerId?)`, so an owner can tell whether any restriction is active and whether its own restriction outlives a settled run.

## Native Durable extension (settings-only)

For Durable 1.1 hosts, import `@abhishek944/pi-research/durable` and install `createAskDurableExtension` in a registry before opening a Harness:

```ts
import { createAskDurableExtension } from "@abhishek944/pi-research/durable";
import { createRegistry } from "@earendil-works/pi-durable";

const registry = createRegistry();
registry.install(createAskDurableExtension({ allowedTools: ["read", "grep", "find", "ls"] }));
// The host opens its own Harness with its models/storage/env and installs the extension.
```

Settings are serializable only: `allowedTools` (exact native tool names, default read-only policy) and `maxAnswerChars` (default 100000). The factory copies and freezes them. Execution context and native api objects come from Durable at execute time. There are no admission, quota, auth, storage, or callback options.

The native `ask` tool creates an owned child conversation, restricts its agent to the intersection of the allowlist with registry tools, enforces the same allowlist through a conversation-scoped guard document, submits the question with a deterministic request id, returns the bounded answer text, and restores the child to unrestricted state. Provider spend is `replay: "unsafe"`; unanswered or empty answers return bounded `isError` text and never fabricate content. A guard state that cannot be verified blocks the tool call.

The native extension keeps the original extension name `pi-ask` and the `pi-ask.state` document kind so existing host registries and stored conversation state stay compatible. Native exclusions are unchanged: no `/ask` or `/ask tools` commands, no desktop event-bus guard protocol or `setActiveTools` behavior, and no TUI status or context injection. Persistent `/ask on` mode is desktop-only; the native `ask` tool always runs one owned child conversation per call.

## Bundled skills

`pi.skills` publishes three read-only workflow skills from `skills/`:

- `research` — repository investigation, debugging, and root-cause analysis before implementation.
- `read-flows` — discover and read repository flow documentation before changing a documented workflow.
- `design-council` — read-only deliberation over architecture, API, data-model, and product decisions.

Each skill is a `SKILL.md` directory. They stay read-only: they do not authorize production edits.

## Notes

- `/ask` needs a question or one of `on`, `off`, `status`, or `tools`. Running it without text shows a usage message.
- Lookup and status tools are optional. Pi uses them only when helpful.
- While the persistent mode is on, switch it off with `/ask off` before a prompt that must change files or run shell commands.
- Anything queued into the same agent run keeps the limited tool set until Pi settles.
- Built-in slash commands and shell commands typed directly by the user are outside this model-tool guardrail.
- This is an extension-level guardrail, not an operating-system sandbox.

## License

Apache-2.0
