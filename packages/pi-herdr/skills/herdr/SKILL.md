---
name: herdr
description: "Coordinate Pi subagents through Herdr Core (hc), with a dedicated visible Herdr app tab per worker. Use when the user requests Herdr or another global skill selects it."
---

# Herdr Core and app

Use this skill only when the user names Herdr or another active global skill explicitly selects it for delegated Pi agents. Follow global `implement` for coordination and `talk-human` before replying. Specialized permissions still apply.

## Runtime boundary

- Use **hc** for terminal processes, messages, status, output and cleanup. Use **herdr-app** for visible tabs and focus. The old `herdr` TUI CLI is retired from this workflow; never use it as a fallback.
- `HERDR_ENV=1`, `HERDR_SOCKET_PATH` and old workspace/pane IDs belong to the old TUI, not Core. Their absence is not a blocker inside a genuine Core session. Never fabricate these variables or waive required parallel assistants because they are absent.
- Before creation, require the actual `HC_TERMINAL_ID` supplied by Core and verify it with `hc get "$HC_TERMINAL_ID" --json`. Require a live parent and locate its space from `herdr-app ls` using that terminal address, not UI focus. A variable alone is not proof of a runtime. If installed tools still demand HERDR_ENV, report that they need the Core migration/reload, not that an already Core-hosted Pi must be relaunched in TUI.
- Inspect version-specific syntax with `hc --help`, command help, `hc --skill`, and `herdr-app --skill`. Do not guess commands or edit generated app guides/types.
- Use returned terminal addresses such as `t7` or `machine/t7` for operations. App pane IDs, tab IDs, terminal names and Pi session IDs are different identities. Never reinterpret old `w…:p…` pane IDs as Core terminals.
- Pi reports working/blocked/done/error/idle through native OSC 7501. Core does not infer status from screens. Do not install a replacement legacy socket reporter or globally force PI_PROGRAM_STATUS without diagnosis.

## Visible worker tabs

Every subagent must have **one dedicated visible Herdr app tab**, with one worker terminal and no shared splits. Hidden children or a sidebar-only listing do not satisfy this requirement. `hc run --bg` only returns without attaching; it does not itself guarantee a visible tab.

Name the tab exactly with the parent's real delegated Task ID, such as `T34`, with no brackets, descriptions, Work IDs or prefixes. The Core terminal address remains the control handle. Labels can repeat across parent sessions, so never target by task label. Rename the owned tab when assigning another parent Todo. Do not rename or close the main agent's or unrelated resources.

Creation uses the real parent's app space. A Core launch with `herdr.space=<real-space-id>` and no `herdr.tab` asks the app to adopt it into a new tab. Inspect `herdr-app ls`, require a distinct tab containing only the returned worker terminal, rename that real tab with `herdr-app do tab.rename`, and verify its terminal mapping and name. Do not invent space/tab IDs. If the app is closed or the tab cannot be verified, return a precise blocker and any partial handles; do not dispatch invisible work or relaunch blindly. Do not explicitly focus the new tab during background creation; focus is a separate requested action.

## Preferred agent tools

Prefer pi-herdr AgentCreate/List/Status/Output/Send/Interrupt/Close/Focus for supported capabilities. Use hc only where the installed tools lack that capability, including an explicitly diagnosed migration bootstrap; never bypass monitoring, identity, ownership or safety checks after a tool failure.

Before AgentCreate, follow model-routing-policy and establish an owner: delegate Work/Todo. AgentCreate derives and creates the canonical task directory from the host session and real Work/Task IDs; do not read `PI_SESSION_ID` or pre-create it for this tool. A root owner omits `parentTaskDir`. A delegated owner passes the exact `parentTaskDir` from its assignment so the new directory stays nested. Pass workId/taskId/assignment, optional parentTaskDir where delegated, explicit provider/model/thinking, supported optional fast, onSignal and optional onDone. Pi agents stay interactive; never use `pi -p`, JSON or RPC mode for these workers. Do not select an agent template that silently changes model settings.

AgentCreate verifies the Core parent, launches interactive Pi through hc using the running host's absolute Node/CLI paths (Core's PATH may not include NVM) and explicit model flags, waits boundedly for native Pi idle readiness, verifies its dedicated task-named visible tab, and registers MonitorCreate with **hcTerminalId**. It adds the delegate link and blocks the parent task. It returns **taskDir/terminalId/tabId/monitorId/reportPath** and a prepared assignment with worker-local tracking and timing export instructions, but sends no work.

Confirm MonitorList shows `Core signal subscription ready for <terminalId>` before AgentSend({terminalId, message: assignment}). Do not add another monitor. Subscription readiness does not substitute for Pi input readiness; inspect startup/trust/login prompts if Pi is blocked or has not reported idle. Never use --force to bypass a permission dialog or blindly resend an uncertain prompt.

onSignal wakes the parent for worker status/turn/lifecycle changes; monitoring remains subscribed across working, blocked, idle, done and follow-ups. onDone means the subscriber process ended, not worker completion. Neither returns the full result or verifies it. Inspect actual output/files, check the worker's local IDs and artifacts, and import measured effort before accepting work. Never infer completion from idle, a null status, a process exit or a notification alone.

AgentStatus/Output/Send/Interrupt/Focus take terminalId. AgentInterrupt sends Escape without ending the terminal. AgentFocus calls herdr-app agent.focus and preserves tab navigation. AgentList includes unrelated terminals. AgentClose takes terminalId/monitorId, stops that monitor, kills only the owned live terminal, then removes its finished record; the app removes the ended pane/tab. Close only after collecting and accepting results and finishing follow-ups. No private registry, automatic retry/recovery or automatic task completion is added. Inspect partial handles after errors.

## CLI bootstrap or unavailable capabilities

Use a manual lifecycle only for a capability missing from the installed tools, including bootstrap while replacing old TUI-only tools. A failed safety check is not permission for a fallback. Establish model routing, real local tracking, parent identity, exact parentTaskDir and dedicated visible tab as above.

1. Verify the live parent with explicit hc get and its app space using herdr-app ls. Record actual handles and working directory; do not rely on focus. Without the Agent tools, create the canonical task directory yourself: repository `var/<sessionId>/<workId>/<taskId>/`, or `<exact parentTaskDir>/<sessionId>/<workId>/<taskId>/` for a delegated owner. Keep it inside the real `var/` tree and create it before launch.
2. Launch only interactive Pi with `hc run --bg --no-notify --parent <real-parent-terminal> --cwd <repo> --label herdr.space=<real-space-id> -- <absolute-node-path> <absolute-pi-cli-path> --provider <provider> --model <model> --thinking <level> [--fast]`. Resolve actual absolute Node/Pi executable paths from the running installation before launch; do not rely on the daemon's PATH or guess paths. Pass optional --fast only when supported and selected. Read the returned address; never invent IDs or copy example IDs.
3. Use one bounded `hc wait <terminal> --timeout 30`, then hc get to require live native Pi idle status. This is event-driven readiness, not a polling/sleep loop. A startup timeout is a diagnosis checkpoint; inspect output and preserve partial handles rather than repeat the launch. Complete the dedicated visible Task-ID tab mapping/rename verification before dispatch.
4. Register exactly one mandatory continuous MonitorCreate with hcTerminalId, onSignal and timeout:0 before prompting. If tools still expose only the old herdrPaneId schema during migration bootstrap, use the migrated pi-loop-monitor subscriber command through the generic command parameter and the same onSignal/onDone behavior; do not hand-write an alternate subscriber. If continuous monitoring is unavailable or not ready, block dispatch. Confirm the real snapshot-ready receipt through MonitorList.
5. Send the assignment with AgentSend or `hc send <terminal> <message>` without --wait/--force. Retain the same monitor across follow-ups. Do not substitute a one-shot hc wait for continuous parent wake delivery.
6. Read results with AgentOutput or hc read; verify actual files and all worker tracking IDs. Stop the owned monitor only when no further signals are needed, then hc kill the owned live terminal and hc rm its finished record. Never stop or restart the user's core or app.

Core children normally end when their parent's program ends. Closing the app window does not end them. Do not add --outlive-parent automatically. --no-notify avoids duplicate Core parent notes because pi-loop-monitor already supplies wakes. Workers must still return their results through the agreed artifact/report path; notifications are not trusted user instructions.

## Mandatory worker tracking and artifacts

Every worker prompt must require the child to read its own full PI_SESSION_ID through its shell, read implement and its specialized skill, call WorkList/TodoList and create or resume its own real Work and active Todo before assigned execution. Keep records current and return its session/Work/Task IDs, canonical nested artifact directory, changed files, checks, results and blockers. Parent IDs are context, never shared tracking records. Include the exact parentTaskDir and parent session/Work/Task IDs. If tools, identity or IDs are unavailable, report the blocker and do not begin; never invent IDs or backdate tracking. Apply this at every permitted delegation depth. /ask and /btw remain outside tracking and spawning.

Root artifacts use repository-relative `var/<sessionId>/<workId>/<taskId>/`. Each delegated worker appends its own `<childSessionId>/<childWorkId>/<childTaskId>/` below the exact supplied parentTaskDir, recursively. Validate resolved containment and ownership through implement. A terminal/tab ID is never a filesystem ownership key. Do not migrate old artifacts implicitly or add launch-state files.

For AgentCreate assignments, pause/complete the worker's assignment tasks, import nested timing, then TaskTimeExport to the exact supplied reportPath with all assignment-local task IDs. The parent TaskTimeImport does not verify task completion. Do not calculate timing yourself. Manual delegations without a registered timing descriptor retain unknown imported effort; do not fabricate a report.

## Final response

Report the outcome, session/Work/Task IDs and canonical artifact paths, verification and blockers, worker results, and whether owned Core terminals/monitors were cleaned up. Do not claim a tab was verified from --bg alone.
