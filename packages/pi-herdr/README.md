# pi-herdr

Herdr Core agent lifecycle tools and the bundled `herdr` coordination skill for Pi, together with the editable `model-routing-policy` skill that supplies subagent provider, model, thinking and Fast choices. Version 0.1.0 extracts the existing tools from pi-tasks without renaming them.

## Install and compatibility

Install this package together with the **compatible local pi-tasks working source** that provides the version-1 delegation bridge. Published `@abhishek944/pi-tasks@0.15.0` does **not** have that bridge and still registers the legacy Agent tools. The coordinated local source keeps version 0.15.0; the number alone does not establish compatibility.

```sh
pi install /path/to/compatible/pi-tasks
pi install git:github.com/abhishek944/pi-herdr
```

Replace the legacy pi-tasks source rather than loading both sources. Preserve unrelated package settings. Reload (`/reload`) or restart Pi after changing packages. If an Agent name is already registered, pi-herdr reports migration instructions and blocks Agent calls instead of overriding tools. A missing or incompatible bridge fails before AgentCreate launches a worker.

Requirements: a modern Pi host supporting nested tool calls, active Work/Todo tools, Herdr Core (`hc`), and updated pi-loop-monitor tools supporting `hcTerminalId`. The Herdr app (`herdr-app`) is optional: only an explicitly presented worker (`present: true`) and `AgentFocus` use it, and the default Core-only lifecycle never calls it. Host Pi modules are peers, not bundled runtime copies. Local development requires those peers available in the dependency tree.

## Tools

| Tool | Purpose |
| --- | --- |
| `AgentCreate` | Derive and create the canonical delegated-task directory, launch interactive Pi through hc, verify native readiness, register monitoring, link/block its task, and return handles plus an unsent assignment. Core-only by default; `present: true` adds a verified dedicated visible Task-ID-named app tab. |
| `AgentList` | List Core terminals, including unrelated terminals. |
| `AgentStatus` | Inspect one returned Core terminal address. |
| `AgentOutput` | Read its screen/history (existing default 50 lines, maximum 200). |
| `AgentSend` | Send a prompt without force or waiting. |
| `AgentInterrupt` | Send Escape without closing the terminal. |
| `AgentClose` | Stop its monitor, kill the owned live terminal, remove its record and clear matching task links. |
| `AgentFocus` | Bring an app-presented worker's visible Herdr app tab forward; reports `focused: false` when no app is available. |

For an existing `owner: delegate` task, `AgentCreate` derives and creates the canonical task directory. Root sessions omit `parentTaskDir`; a delegated worker passes the exact `parentTaskDir` from its assignment:

```typescript
AgentCreate({
  workId: "W1", taskId: "T2",
  // parentTaskDir: "<exact parentTaskDir from your assignment>", // delegated workers only
  // present: true, // optional: adopt the worker into its own visible task-named app tab
  assignment: "Review the approved change without editing files.",
  provider: "<selected-provider>", model: "<selected-model>", thinking: "high",
  onSignal: "Inspect the actual worker output and import its measured timing."
})
```

A root caller gets `var/<host-sessionId>/<workId>/<taskId>/`. A delegated caller gets `<parentTaskDir>/<host-sessionId>/<workId>/<taskId>/`. Do not shell-read the session ID or pre-create either directory; the tool returns the resolved `taskDir` after creating it. Direct `hc` CLI launches still prepare their canonical directories manually.

Creation returns `taskDir`, `terminalId`, `monitorId`, `reportPath`, `presented`, `assignment`, and `assignmentSent: false`; `tabId` is included only when `present: true` adopted and verified a real app tab. Confirm MonitorList shows the Core subscription ready, then AgentSend the assignment. Keep that monitor for follow-ups. Signals, idle state and process exit are not proof of task completion: read output/files, verify results, import timing and only then close owned resources. Failures report partial handles without retries or automatic cleanup. Presentation is checked for an open app space before launch, so a missing app fails before a worker exists; an adoption failure after launch reports the live terminal for the caller to inspect or close.

Use the bundled `herdr` skill for the complete authorization, model-routing, worker-local tracking and nested artifact contract. Mutation tools require tracked main-conversation work, never `/ask` or `/btw`; list/status/output retain their read-only behavior. Core-only workers need no app, space, tab or adoption label, so headless hosts can use the Agent tools; only requested presentation and focus touch the app. No legacy Herdr TUI fallback, HERDR_ENV requirement, worker registry or automatic recovery is added.

## Bundled skills

| Skill | Purpose |
| --- | --- |
| `herdr` | Authorization, delegation, Core/app lifecycle, monitoring and artifact contract for the Agent tools. |
| `model-routing-policy` | Default subagent provider, model, thinking level and Fast mode, kept as one editable skill file. |

`skills/model-routing-policy/SKILL.md` is the only copy of the routing defaults. `implement`, `agent-review`, `herdr`, `firstmate`, and the package-provided `grill-me` and `ui-ux-grill-me` skills read it by name before launching agents. Edit that skill to change the choices; explicit user choices still override it and the parent agent's model is unchanged. Nothing in the extension hard-codes those model names, so an edit takes effect after `/reload` or a restart without rebuilding.

The policy was previously a standalone global skill managed by the shared skills repository. This package is now its source of truth. After the package loads, remove any old `~/.agents/skills/model-routing-policy/` copy so Pi does not discover both sources under the same name.

## Ownership

- **pi-herdr:** Agent tools, Core/app lifecycle orchestration, and the bundled `herdr` and `model-routing-policy` skills.
- **pi-tasks:** Work/Todo records, timing, delegate metadata and task displays, including their UI CLI helpers.
- **pi-loop-monitor:** continuous supervision and wake delivery.
- **Core / Herdr app:** processes by Core / optional visible tabs and focus by the app. The default lifecycle is Core-only; presentation is an explicit per-worker opt-in.

The synchronous `pi-tasks:delegation-api` event request `{version: 1, respond(api)}` discovers task-owned `prepare(ctx, {workId, taskId, taskDir})`, `attach(ctx, {workId, taskId, terminalId, monitorId, reportPath})`, and `detach(ctx, {terminalId})`. AgentCreate derives and validates `taskDir` from the host session and real Work/Task IDs; prepare validates the delegate assignment, creates the directory if absent inside the repository's real `var/`, and writes the timing descriptor there. Prepare returns a timing report path; attach records timing/link metadata and blocks the parent; detach preserves AgentClose metadata cleanup. The bridge validates current-session ownership and active tracking tools, rejecting retained APIs after session replacement. There are no cross-install internal imports or new task stores.

## Development and licenses

Run `npm run typecheck`, `npm run lint`, `npm run build`, and `npm pack --dry-run` for static verification. Generated `dist/`, the skill and license notices ship with the package. Live interactive end-to-end verification is user-owned.

Agent code is MIT, copyright (c) 2026 Abhishek Tatikella, extracted from pi-tasks. `model-routing-policy` is original package content under the same MIT license. The locally adapted Herdr-derived skill retains Apache-2.0 provenance. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the MIT code license does not relicense the skill.
