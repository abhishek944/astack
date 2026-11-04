# Changelog

## 0.2.0 - 2026-11-04

- Added the approved persistent Ask mode: `/ask on` captures the active tools once, keeps every ordinary prompt inside the read-only policy until `/ask off`, and shows `Ask · read-only` in the footer. `/ask off` restores exactly the captured tool list. `/ask status` reports the current state, and repeating `on` or `off` changes nothing. The mode is in-memory and session-scoped, so reload, session replacement and shutdown end it instead of applying another session's tool list.
- Kept `/ask <question>` as a one-shot restricted answer and `/ask tools` as a metadata-only report; both now also recognize the persistent mode.
- Extended the reusable guard additively without changing protocol version 1: `acquire` accepts optional `persistent` and `sessionId`, `PiAskGuard` adds `isPersistent`, a persistent owner survives `agent_settled` until it releases the guard, and release restores exactly the captured list. Another caller still receives `busy` while any restricted run owns the guard, so read-only `pi-loop-monitor` wakes wait for the release as before. First Mate uses the existing probe and release events to keep its own gate composed with this mode.
- Persistent mode receives no conversation instructions, matching the existing one-shot behavior.

## 0.1.0 - 2026-11-03

- Moved the package from `@abhishek944/pi-ask` into Astack as `@abhishek944/pi-research`. The release history below is carried forward unchanged.
- Bundled the `research`, `read-flows`, and `design-council` skills, so the package is the single source for its read-only research workflows.
- `/ask` now defaults to read-only tools only: `image_generate` and `sprite_generate` were removed from both the desktop and the native Durable default allowlists. Shell, file-changing, generation, and delegation tools stay unavailable.
- Kept the reusable guard compatible for existing consumers: the `pi-ask:guard:*` events (protocol version 1), the `PiAskGuard` exports and `./guard` subpath, and the native Durable extension name and state document kind are unchanged.

## 0.4.4 - 2026-11-03

- Added `@abhishek944/pi-ask/durable`, a settings-only native Durable extension that installs one `ask` tool for Durable 1.1 hosts.
- The native `ask` tool runs an owned child conversation restricted to the intersection of the configured `allowedTools` (read-only by default) with the registry tools, then restores it to unrestricted state.
- Returned answer text is bounded by `maxAnswerChars`, provider spend is marked `replay: "unsafe"`, and unanswered or empty answers return bounded `isError` text instead of fabricated content.
- The native extension excludes `/ask` commands, the desktop guard event protocol, and TUI status or context injection.

## 0.4.3 - 2026-10-18

- Keep `/ask` tool restrictions scoped to its answer without injecting Ask Mode instructions into the conversation.
- Remove the manual `/ask reset` command and automatically restore leftover Ask tools before the next idle prompt.
- Preserve the reusable guard API and restrictions owned by other extensions.

## 0.4.2

- Removed the active restricted-answer warning for `/ask`.
- Automatically clear the previous Ask guard before starting a new idle `/ask`, so stale Ask state no longer silently blocks the command.

## 0.4.1 - 2026-10-17

- Fixed Ask startup with Pi 1.3.0 by accepting both current and legacy built-in tool provenance paths while preserving the existing tool restrictions.
- Removed the misleading acquisition-failure warning that claimed another restricted answer was active. Failed guard activation still prevents an unrestricted answer.

## 0.4.0 - 2026-10-17

- Added `/ask tools`, a local metadata-only report of the effective Ask tools, tools removed by the Ask policy, and allowlisted tools that are inactive or not registered. It starts no model turn, changes no guard or tool state, and labels itself a preview when Ask is not active.

## 0.3.0 - 2026-10-12

- Allowed optional web activation, sprite generation, and read-only work, todo, loop, and monitor status tools during `/ask`.
- Clarified that image and sprite outputs are allowed while tracking mutations and other project-file changes remain blocked.

## 0.2.0 - 2026-09-12

- Added the reusable read-only guard API and shared event protocol.
- Added exact top-level tool-input constraints, tool-provenance checks, complete-run lifecycle tracking, and automatic restoration.
- Added programmatic run markers and guard release notifications for extension integrations.

## 0.1.0

- Initial `/ask` release.
