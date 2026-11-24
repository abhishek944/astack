# pi-herdr

Herdr Core agent lifecycle tools and the bundled `herdr` coordination skill for Pi, together with the editable `model-routing-policy` skill that supplies subagent provider, model, thinking and Fast choices, and the usage fallback that switches to the policy's `default` rule when a model's plan usage is exhausted. Version 0.1.0 extracts the existing tools from pi-tasks without renaming them.

## Install and compatibility

Install this package together with the **compatible local pi-tasks working source** that provides the version-1 delegation bridge. Published `@abhishek944/pi-tasks@0.15.0` does **not** have that bridge and still registers the legacy Agent tools. The coordinated local source keeps version 0.15.0; the number alone does not establish compatibility.

```sh
pi install /path/to/compatible/pi-tasks
pi install git:github.com/abhishek944/pi-herdr
```

Replace the legacy pi-tasks source rather than loading both sources. Preserve unrelated package settings. Reload (`/reload`) or restart Pi after changing packages. If an Agent name is already registered, pi-herdr reports migration instructions and blocks Agent calls instead of overriding tools. A missing or incompatible bridge fails before AgentCreate launches a worker.

Requirements: a modern Pi host supporting nested tool calls, active Work/Todo tools, Herdr Core (`hc`), and updated pi-loop-monitor tools that support `hcTerminalId`, wait for the Core subscription-ready receipt, and expose structured `MonitorList` summaries. The Herdr app (`herdr-app`) is optional: only an explicitly presented worker (`present: true`) and `AgentFocus` use it, and the default Core-only lifecycle never calls it. Host Pi modules are peers, not bundled runtime copies. Local development requires those peers available in the dependency tree.

## Tools

| Tool | Purpose |
| --- | --- |
| `AgentCreate` | Derive and create the canonical delegated-task directory, launch interactive Pi through hc, verify native readiness, register monitoring, link/block its task, and return handles plus an unsent assignment. Returns `status: "ready"` or, after launch, `status: "partial"` with the same handles and an `AgentResume` next step; partial state retains `presentRequested`/`presentation` and marks an unfinished required tab in `missing`. Core-only by default; `present: true` adds a verified dedicated visible Task-ID-named app tab. |
| `AgentResume` | Finish startup for the same worker returned by a partial AgentCreate. Validates the timing descriptor and task directory, proves Core ownership through the parent and `pi.task`/`pi.session` labels, requires idle Pi, verifies/finishes a required `present: true` dedicated task-named tab, reuses one ready Core subscription or replaces a non-ready one, and attaches timing/linkage. Never relaunches, dispatches a required visible worker as hidden, duplicates monitoring, bypasses prompts or fabricates timing. |
| `AgentList` | List Core terminals, including unrelated terminals. |
| `AgentStatus` | Inspect one returned Core terminal address. |
| `AgentOutput` | Read its screen/history (existing default 50 lines, maximum 200). |
| `AgentSend` | Send a prompt without force or waiting. |
| `AgentInterrupt` | Send Escape without closing the terminal. |
| `AgentClose` | Stop its monitor when supplied, kill the owned live terminal, remove its record and clear matching task links. A partial worker whose monitor was never created can be closed with only `terminalId`. |
| `AgentFocus` | Show an existing Core agent through the Herdr app. A terminal that owns a pane, or another machine's terminal, gets normal `agent.focus`; a pane-less sub-agent opens its own `terminal.peek` screen overlay over the current tab without navigating to its parent. This assumes `hc` and the running app target the same Core; it does not perform Pet Town's `verified_world` cross-Core anchor. Reports `focused: false` with a reason when no app is available or the agent cannot be shown. |

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

Creation returns `status: "ready"`, `taskDir`, `terminalId`, `monitorId`, `reportPath`, `presented`, `assignment`, and `assignmentSent: false`; `tabId` is included only when `present: true` adopted and verified a real app tab. MonitorCreate waits for the Core subscription-ready receipt before creation succeeds. Confirm MonitorList shows that readiness, then AgentSend the assignment. Keep that monitor for follow-ups. Signals, idle state and process exit are not proof of task completion: read output/files, verify results, import timing and only then close owned resources.

Completing a delegate task with its Core worker record still linked appends one advisory to the `TodoUpdate` result. pi-herdr emits it only after `hc get` proves the terminal is a child of this host with matching `pi.session` and `pi.task` labels, so nested delegation and unrelated terminals are never targeted. The parent decides whether a real follow-up dependency remains or whether to send `/close`, read `improvements.md`, import timing, then `AgentClose`; the advisory itself sends no command, changes no task status, and repeats only if the task is completed again. Recording a real follow-up as `blocked` with `dependentOn="another-agent"` is not a completion transition.

A failure after the worker terminal exists returns a successful tool result with `status: "partial"`, the `phase` that failed, `completed`/`missing` handles, `presentRequested`/`presentation`, the error, the prepared assignment and `next: AgentResume`. When `present: true` was requested but the dedicated tab was not verified, `missing` includes `presentation`; the next step includes `present: true`. It never relaunches or cleans up automatically. Pre-launch failures still throw because there is no worker to resume. Presentation is checked for an open app space before launch, so a missing app fails before a worker exists; an adoption failure after launch reports the live terminal for the caller to inspect or close.

`AgentResume({ workId, taskId, terminalId, taskDir, reportPath, present?, onSignal, onDone? })` resumes that exact worker. It validates the timing file through pi-tasks, requires the directory to end with the current session/work/task below `var/`, and proves the Core terminal is a child of this host with matching `pi.task`/`pi.session` labels. A `present: true` requirement is preserved from the partial result or recovered from the worker's `herdr.space` launch label. When required, resume verifies and finishes that same worker's dedicated task-named tab before it can return ready; if the parent is not shown or the tab cannot be verified, it returns `partial` with `presentation` still missing and a concrete app dependency. It never dispatches a required visible worker as hidden. It requires an idle Pi, so trust/login/blocked states are reported as `not_ready` with no mutation. It reuses a ready running monitor; a running monitor that never reported ready is stopped before exactly one replacement is created; more than one running subscription is an error. It then attaches delegate linkage/timing and reports `timing: "placeholder" | "measured"`. A placeholder stays unknown until the worker's own TaskTimeExport writes measured effort; resume never writes or calculates time. Post-validation failures return `partial` for another resume attempt, not a relaunch.

Use the bundled `herdr` skill for the complete authorization, model-routing, worker-local tracking and nested artifact contract. Mutation tools require tracked main-conversation work, never `/ask` or `/btw`; list/status/output retain their read-only behavior. Core-only workers need no app, space, tab or adoption label, so headless hosts can use the Agent tools; only requested presentation and focus touch the app. No legacy Herdr TUI fallback, HERDR_ENV requirement, worker registry or automatic recovery is added.

## Bundled skills

| Skill | Purpose |
| --- | --- |
| `herdr` | Authorization, delegation, Core/app lifecycle, monitoring and artifact contract for the Agent tools. |
| `model-routing-policy` | Default subagent provider, model, thinking level and Fast mode, kept as one editable JSON block inside a skill file, including the `default` rule the usage fallback switches to. |

`skills/model-routing-policy/SKILL.md` is the only copy of the routing defaults. Its policy is one `json` block (`rules` plus the `notes` that qualify them) inside the Markdown body; the frontmatter and prose stay as they are. `implement`, `agent-review`, `herdr`, `firstmate`, and the package-provided `grill-me` and `ui-ux-grill-me` skills read it by name before launching agents. Edit that skill — or Herdr's Routing panel, which edits the same block — to change the choices; explicit user choices still override it and the parent agent's model is unchanged. Nothing in the extension hard-codes those model names, so an edit takes effect after `/reload` or a restart without rebuilding. The Routing panel only writes the file: it never reloads or updates a running agent.

The policy was previously a standalone global skill managed by the shared skills repository. This package is now its source of truth. After the package loads, remove any old `~/.agents/skills/model-routing-policy/` copy so Pi does not discover both sources under the same name.

## Usage fallback

When a turn ends with a confirmed plan or workspace usage limit, the extension acts on that turn
itself, before Pi retries the request and before any queued message starts a run. It reads the rule
whose `when` is exactly `default`, switches the session to its model with `pi.setModel()`, applies
its thinking level, and lets the interrupted work resume on that model; a retry or a queued run
already uses the fallback, so the exhausted model is asked exactly once. Provider wording for a
transient throttle, an authentication failure, a context-window error, a cancellation, or a generic
billing problem never triggers it, and it never forces Fast mode. The switch overrides
responsibility-specific rules only for work already in progress; new subagents still follow those
rules.

Occasionally there is nothing safe to switch to: the `default` rule is missing or invalid, it names
the exhausted model, its model is not in the registry, or its credentials are absent. Then the
extension reports why and aborts the operation immediately. That stops Pi's own retry and the
settlement boundary, and therefore pi-tasks auto-continue, so no further request reaches the
exhausted model. Pi's abort path returns queued input to the editor in interactive mode; the
extension also records the reason and any queued text in a session entry so nothing is lost
silently. Both decisions happen on the failed turn, so extension load order and handler order do not
affect them.

Usage fallback needs no build-time model name: change the `default` rule in the skill (or through
the Routing panel) and the next exhaustion uses it after `/reload`.

## Ownership

- **pi-herdr:** Agent tools, Core/app lifecycle orchestration, and the bundled `herdr` and `model-routing-policy` skills.
- **pi-tasks:** Work/Todo records, timing, delegate metadata and task displays, including their UI CLI helpers.
- **pi-loop-monitor:** continuous supervision and wake delivery.
- **Core / Herdr app:** processes by Core / optional visible tabs and focus by the app. The default lifecycle is Core-only; presentation is an explicit per-worker opt-in.

The synchronous `pi-tasks:delegation-api` event request `{version: 1, respond(api)}` discovers task-owned `prepare(ctx, {workId, taskId, taskDir})`, `inspect(ctx, {workId, taskId, taskDir, reportPath})`, `attach(ctx, {workId, taskId, terminalId, monitorId, reportPath})`, and `detach(ctx, {terminalId})`. AgentCreate derives and validates `taskDir` from the host session and real Work/Task IDs; prepare validates the delegate assignment, creates the directory if absent inside the repository's real `var/`, and writes the timing descriptor there. Prepare returns a timing report path; attach records timing/link metadata and blocks the parent; detach preserves AgentClose metadata cleanup. `inspect` is optional in version 1 but required by AgentResume: it validates that an existing descriptor is inside the canonical task directory, belongs to this parent assignment, and is either a fresh placeholder or a measured report. The bridge validates current-session ownership and active tracking tools, rejecting retained APIs after session replacement. There are no cross-install internal imports or new task stores.

## Development and licenses

Run `npm run typecheck`, `npm run lint`, `npm run build`, and `npm pack --dry-run` for static verification. Generated `dist/`, the skill and license notices ship with the package. Live interactive end-to-end verification is user-owned.

Agent code is MIT, copyright (c) 2026 Abhishek Tatikella, extracted from pi-tasks. `model-routing-policy` is original package content under the same MIT license. The locally adapted Herdr-derived skill retains Apache-2.0 provenance. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the MIT code license does not relicense the skill.
