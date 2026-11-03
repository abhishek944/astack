# pi-herdr

Herdr Core agent lifecycle tools and the bundled `herdr` coordination skill for Pi. Version 0.1.0 extracts the existing tools from pi-tasks without renaming them.

## Install and compatibility

Install this package together with the **compatible local pi-tasks working source** that provides the version-1 delegation bridge. Published `@abhishek944/pi-tasks@0.15.0` does **not** have that bridge and still registers the legacy Agent tools. The coordinated local source keeps version 0.15.0; the number alone does not establish compatibility.

```sh
pi install /path/to/compatible/pi-tasks
pi install git:github.com/abhishek944/pi-herdr
```

Replace the legacy pi-tasks source rather than loading both sources. Preserve unrelated package settings. Reload (`/reload`) or restart Pi after changing packages. If an Agent name is already registered, pi-herdr reports migration instructions and blocks Agent calls instead of overriding tools. A missing or incompatible bridge fails before AgentCreate launches a worker.

Requirements: a modern Pi host supporting nested tool calls, active Work/Todo tools, Herdr Core (`hc`), the Herdr app (`herdr-app`) with the parent terminal displayed, and updated pi-loop-monitor tools supporting `hcTerminalId`. Host Pi modules are peers, not bundled runtime copies. Local development requires those peers available in the dependency tree.

## Tools

| Tool | Purpose |
| --- | --- |
| `AgentCreate` | Launch interactive Pi, verify native readiness and a dedicated visible Task-ID-named tab, register monitoring, link/block its task, and return handles plus an unsent assignment. |
| `AgentList` | List Core terminals, including unrelated terminals. |
| `AgentStatus` | Inspect one returned Core terminal address. |
| `AgentOutput` | Read its screen/history (existing default 50 lines, maximum 200). |
| `AgentSend` | Send a prompt without force or waiting. |
| `AgentInterrupt` | Send Escape without closing the terminal. |
| `AgentClose` | Stop its monitor, kill the owned live terminal, remove its record and clear matching task links. |
| `AgentFocus` | Focus its visible Herdr app tab. |

For an existing `owner: delegate` task and canonical task artifact directory:

```typescript
AgentCreate({
  workId: "W1", taskId: "T2",
  taskDir: "var/<full-current-sessionId>/W1/T2",
  assignment: "Review the approved change without editing files.",
  provider: "<selected-provider>", model: "<selected-model>", thinking: "high",
  onSignal: "Inspect the actual worker output and import its measured timing."
})
```

Creation returns `terminalId`, `tabId`, `monitorId`, `reportPath`, `assignment`, and `assignmentSent: false`. Confirm MonitorList shows the Core subscription ready, then AgentSend the assignment. Keep that monitor for follow-ups. Signals, idle state and process exit are not proof of task completion: read output/files, verify results, import timing and only then close owned resources. Failures report partial handles without retries or automatic cleanup.

Use the bundled `herdr` skill for the complete authorization, model-routing, worker-local tracking and nested artifact contract. Mutation tools require tracked main-conversation work, never `/ask` or `/btw`; list/status/output retain their read-only behavior. No legacy Herdr TUI fallback, HERDR_ENV requirement, worker registry or automatic recovery is added.

## Ownership

- **pi-herdr:** Agent tools, Core/app lifecycle orchestration and bundled herdr skill.
- **pi-tasks:** Work/Todo records, timing, delegate metadata and task displays, including their UI CLI helpers.
- **pi-loop-monitor:** continuous supervision and wake delivery.
- **Core / Herdr app:** processes / visible tabs and focus.

The synchronous `pi-tasks:delegation-api` event request `{version: 1, respond(api)}` discovers task-owned `prepare(ctx, {workId, taskId, taskDir})`, `attach(ctx, {workId, taskId, terminalId, monitorId, reportPath})`, and `detach(ctx, {terminalId})`. Prepare returns a timing report path; attach records timing/link metadata and blocks the parent; detach preserves AgentClose metadata cleanup. The bridge validates current-session ownership and active tracking tools, rejecting retained APIs after session replacement. There are no cross-install internal imports or new task stores.

## Development and licenses

Run `npm run typecheck`, `npm run lint`, `npm run build`, and `npm pack --dry-run` for static verification. Generated `dist/`, the skill and license notices ship with the package. Live interactive end-to-end verification is user-owned.

Agent code is MIT, copyright (c) 2026 Abhishek Tatikella, extracted from pi-tasks. The locally adapted Herdr-derived skill retains Apache-2.0 provenance. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the MIT code license does not relicense the skill.
