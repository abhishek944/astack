# pi-tasks usage

## Session-only storage

Tasks belong only to the Pi session ID, not to conversation branches. Pi reads and atomically writes `<agent-directory>/tasks/<sessionId>.json`, normally `~/.pi/agent/tasks/<sessionId>.json`. The Pi TUI and native Herdr pane display the same document. Navigating the conversation tree never rolls tasks back. Resume/reload preserves the session file; a fork with a new session ID starts empty. Do not open the same session in multiple independent Pi writer processes.

Existing sessions without a task file import the selected legacy task view once, preserving old session history. Pre-upgrade forks with their own task edits migrate that old view. Fresh interactive and CLI forks start empty; copied-only legacy entries do not count as new-session tasks. Legacy fork migration may need its parent history file to distinguish inherited events; restore that file if migration reports it unavailable. Subsequent edits no longer append task events to that history. Back up the JSON file when upgrading or moving sessions; exporting/sharing conversation JSONL does not include this separate task file. Invalid or mismatched files are reported without overwriting them. If a file disappears after initialization, restore it instead of expecting automatic history replay. Old extension versions do not see post-migration edits.

## Panel visibility and Herdr Tasks pane

`/works` alone opens the overlay dashboard. `/works compact-on` and `/works compact-off` show/hide the compact Pi display; `/works herdr-on` and `/works herdr-off` open/focus or close only the native Tasks mod panes bound to this session and terminal. Repeating off is harmless when no matching panel exists. The compact display and native panel are independent; off never disables tracking or changes another session’s panel. The separate `/works-panel` command is removed; its auxiliary directory, delegate, minimize/maximize, and floating/widget actions are now subcommands of `/works`.

Set the compact TUI default in global or trusted-project settings, then `/reload`:

```json
{
  "pi-tasks": {
    "panel": { "enabled": false, "mode": "floating" }
  }
}
```

`enabled` defaults to false; the compact TUI stays hidden unless explicitly enabled. `mode` accepts floating (default) or widget. Settings require Pi 1.2+ `getSettings`; older hosts keep defaults. `/works compact-on` shows the last selected visible mode, `/works compact-off` hides it, and floating/widget commands both select and show a layout. Commands override only the running extension instance and do not rewrite settings. Hiding does not disable tools, timing or continuation. `/works` remains an explicit on-demand dashboard.

Set the native Herdr pane default in the same settings object:

```json
{
  "pi-tasks": {
    "herdrPanel": { "enabled": true }
  }
}
```

`pi-tasks.herdrPanel.enabled` defaults to false. When true, each new TUI session inside a local Herdr Core terminal installs missing assets and opens/focuses the Tasks pane at session start; a Tasks pane from the same terminal’s earlier session is replaced. Automatic startup keeps setup failures silent. `/works herdr-off` still closes the running session’s pane, and `/works herdr-on` still reports setup problems. Settings apply on startup/reload; commands never rewrite them.

The package includes a native read-only mod at `herdr/pi-tasks/`. `/works herdr-on` automatically installs its missing files into your personal Herdr app home as `mods/pi-tasks/` (normally `~/.config/herdr-app/mods/pi-tasks/`; respecting `XDG_CONFIG_HOME` but ignoring inherited `HERDR_APP_HOME` fixture overrides for both app commands and asset installation), then opens the pane. No manual copying is required. Existing files, including customizations, are never overwritten; this is missing-file installation, not automatic mod upgrades. Developers can validate the installed mod with:

```sh
herdr-app check ~/.config/herdr-app/mods/pi-tasks
```

From a local Pi terminal already displayed in Herdr, run `/works herdr-on` to install/open the Tasks pane beside that exact terminal, or enable `pi-tasks.herdrPanel.enabled` for automatic startup. The command first requires an initialized, valid snapshot for the current Pi session; it does not create a pane with missing binding props. If a running instance mixes older task modules with the updated command, restart Pi and resume the session before retrying. The first panel opens beside the source terminal. If same-session Loops/Monitors is already open, Tasks stacks below it instead. Reopening focuses the existing Tasks pane; closing either panel leaves the other in place. The command passes the session ID and authoritative snapshot path explicitly. It does not start another Pi process or choose whichever terminal happens to have focus. Use `/works compact-off` or the setting above to avoid duplicate compact TUI display. The mod reads/watches the file and shows a compact Work→Task tree with inline name-activated Final thoughts, leading running/blocked symbols, right-aligned numeric metrics and adjacent linked-task-only Agent buttons. Its pane header adds one compact status dropdown (All statuses, Active, Blocked, Completed, Cancelled) that shows only matching tasks and the Works containing them; Work progress and effort remain totals for every task, and the selection is per-pane view state read from Herdr's shared store under `pi-tasks-status:<paneId>`, never a settings entry or a task-record write. The opener also writes the hosting pane id to `<agentDir>/tasks/<sessionId>.pane` and passes `paneFile`, because a pane content copy cannot name its own pane; reopening the pane refreshes it. A pane created before that hand-off carries no `paneFile` prop and its stored props never change, so the view falls back to the live pane inventory and adopts the one Tasks pane in the source terminal's tab; anything absent, malformed or ambiguous leaves the view at All statuses instead of guessing another pane's selection. An edited mod reaches existing panes when the Herdr app starts or a pane is closed and reopened, independently of Pi process age. It omits owner/status fact lines, connection/session bars and the bottom Read-only footer. It does not write task state or run model calls. Remote sessions and task editing from the pane are not included.

The persistent close button lives in the actual native pane header. First setup creates/selects personal copies of the current visible top-header layout and its header mod; originals remain untouched and non-Tasks header behavior uses the copied original. A minimum 32px header supports the close target. Conflicting custom assets or unsupported header layouts fail with guidance rather than being overwritten. See [native header setup and rollback](../herdr/pi-tasks/README.md). The native content has no three-dot trigger or action menu. Copy and repository actions remain available through the `/works` dashboard and commands; reopen the native pane after a watcher error.

## Automatic tracking

For every normal request that starts or continues work, Pi should:

1. Find existing work and todos.
2. Create the relevant Work collection, or refresh its shared context when needed.
3. Create a todo for each distinct new actionable request, or update an existing todo that already owns the same outcome, with hidden coordination metadata and a concise visible Final thoughts when useful. Adding a request to an existing Work does not make it part of an existing todo.
4. Mark the current todo active before starting it. For an `owner: self` task, include `working=true` to select it for automatic timing; re-select at the start of each fresh run.
5. During longer tasks, report interim progress after roughly 5–10 meaningful working steps or a milestone, when an estimate is possible. Update Final thoughts only when the change is significant.
6. Mark the todo blocked only when its next step waits for a user decision or another agent's output or review. Supply the current `blockedReason` and `dependentOn` (`"user-decision"` or `"another-agent"`); otherwise update it after the attempt as active, completed, or cancelled, with a concise result when completing.
7. Keep status on tasks only; update Work context when scope or shared decisions change.

The extension applies this guidance across all loaded skills and does not skip work merely because it looks small. It does not update tracking during `/ask`, `/btw`, or BTW side threads.

Write `workInfo` in normal prose with full sentences and spaces between words. Conversational brevity modes do not apply to stored records; do not concatenate words to shorten them. `taskInfo` is hidden coordination metadata: the owner declaration, canonical artifact paths, parent IDs, and necessary execution constraints. `finalThoughts` is the only user-visible task text; see [Final thoughts](#final-thoughts). This is model-facing guidance, not automatic repair of existing text.

## Shared workflow and artifacts

Every tracked Work, including each worker's local Work, uses the globally installed `implement` skill for coordination. Read it once before execution, or reuse it if active. Specialized skills retain their scope: research and review remain read-only, and planning does not authorize implementation. Plain conversation, `/ask`, and `/btw` remain outside this workflow. Pi-tasks owns records and progress; `implement` owns coordination, artifact paths, and integration; `herdr` owns delegated-agent lifecycle and monitors. This instruction does not install those skills or add runtime enforcement. If `implement`, tracking tools, or required IDs are unavailable, report the blocker rather than executing without them.

Read the full current session ID through the agent's own shell tool:

```bash
printf '%s\n' "$PI_SESSION_ID"
```

Startup includes reading instructions, obtaining identity, and creating/resuming tracking. Before execution, require a nonempty session ID matching `[A-Za-z0-9][A-Za-z0-9_-]*`, a real tool-returned Work ID, and an active Task ID. Do not invent IDs, use a Herdr pane/name as identity, or substitute the parent's session ID. Hosts/custom shell tools that do not expose session identity must report that blocker.

Root task artifacts use repository-relative `var/<sessionId>/<workId>/<taskId>/`, never the system `/var/`. A delegated worker appends its own `<childSessionId>/<childWorkId>/<childTaskId>/` below the exact `parentTaskDir` from its assignment, recursively. For example:

```text
var/<rootSessionId>/W1/T2/
  plan.md
  <childSessionId>/W1/T1/
    report.md
```

Record the canonical artifact directory and parent session/Work/Task IDs in `taskInfo`, pass them unchanged in handoffs, and return them with results. Keep resolved destinations inside the repository's `var/`, including symlinks. Create folders only for useful artifacts; feature names remain descriptions rather than path keys. Each task owns its files and links to shared coordinating-task plans rather than copying them. Reuse recorded paths only after verifying current ownership, especially after session-branch navigation; matching numeric IDs alone do not authorize overwriting artifacts. Preserve existing artifacts unless an explicit migration is approved. Follow `implement` for detailed path handling and report incompatible legacy helper paths rather than inventing unsupported arguments or silently falling back to feature-named directories.

### Choose self or delegate

Before each task, start hidden `taskInfo` with `owner: self` or `owner: delegate` and a short reason. Preserve this declaration when updating the task. Delegate only when scope and acceptance criteria are clear, ownership can be isolated, required inputs and verified prerequisites are ready, and useful parallelism or expertise outweighs startup, context transfer, monitoring, and integration costs. The owning skill must permit delegation and required tracking and monitoring must be available. Small straightforward changes, tightly coupled edits, shared-interface design, and expensive-to-explain work normally stay with one owner. Risk alone is not a reason for parallel coding; independent review may still help. Do not use arbitrary file-count, agent-count, or depth thresholds. Reassess if scope changes; each allowed delegating child applies the same rule, and parents retain responsibility for monitoring, integration, verification, and cleanup.

Workers are Core-only by default; no Herdr app, space, tab or adoption label is needed. When the user or the active harness explicitly requires a visible worker, pass `present: true` to AgentCreate, and that Core subagent gets its own Herdr app tab named exactly with the parent's delegated Todo ID, such as T34, without brackets or descriptions. Rename the owned tab when assigning a different parent Todo. The tab label is not the worker's session/Task identity. Use real returned terminalId/tabId handles because labels repeat across parent sessions; `tabId` exists only for a presented worker.

These are instructions using existing details fields, not a new schema, shared cross-session task tree, automatic directory creator, or enforcement hook.

## Delegated agents

Every subagent must create or resume its own session-local Work and Todos before starting its assignment, at every delegation depth. It must have a real `workId` and an active `taskId` for the current step, keep its records current, and return the IDs with results, checks, and blockers. Include this requirement, the `implement`/specialized skill handoff, parent session/Work/Task IDs, and the canonical parent task directory in every worker prompt. Require the worker to return its own session/Work/Task IDs and canonical nested artifact directory. Record parent assignment IDs as context, not as shared records: each Pi session has its own IDs. If tracking tools or IDs are unavailable, the worker must report the blocker and not begin assigned work; a parent-owned Todo or Markdown checklist is not a substitute. Never invent IDs or claim tracking existed before it did. This is model-facing guidance, not a runtime enforcement hook; `/ask` and `/btw` remain outside tracking.

## Statuses and dependencies

Works are collections with no status. Tasks use only `active`, `blocked`, `completed`, and `cancelled`. New tasks default to `active`; saved legacy task statuses `planned` and `pending` restore as active but are no longer accepted by tools. Old Work statuses are ignored during replay; no saved history is rewritten.

Use `blocked` only when a task cannot proceed until a user decision (a response, approval, or permission) or another agent's output or review arrives. Supply both `blockedReason` and `dependentOn` when creating a blocked task or entering blocked status: `dependentOn` is exactly `"user-decision"` or `"another-agent"`. Explain which dependency it awaits and what will unblock it. That reason is the blocked task's visible Final thoughts, so do not duplicate it; task details show the chosen dependency beside Final thoughts. Retain its current completion estimate. Other blocked edits preserve both fields; leaving blocked clears both. Older blocked tasks without a reason or dependency show no invented values, and no reason falls back to Final thoughts. Do not use blocked for an external service, tool failure, or other obstacle that fits neither category: keep the task active, preserve safety, continue other safe work, and report the unavailable dependency truthfully. A status change clears an unsupplied thought, so resumed and completed rows never show a stale waiting message. Parent delegated tasks stay blocked while awaiting worker output; the worker's own local tasks may be active. AgentCreate automatically blocks the parent task after successful creation, retaining its progress. For manual delegation, mark the parent task blocked explicitly.

When the dependency resolves and work resumes, mark the affected tasks active. Do not assign status to the parent Work. To cancel the whole collection, cancel its remaining tasks explicitly. Neither blocked status nor changing it schedules a wake automatically; use the appropriate monitor or event when an automatic notification is needed.

## Continue unfinished work automatically

This is off by default and requires Pi 1.2.0+. Add the following to global `~/.pi/agent/settings.json` (or your custom agent directory) or a trusted project's `.pi/settings.json`, then run `/reload`:

```json
{
  "pi-tasks": {
    "autoContinue": {
      "enabled": true
    }
  }
}
```

Send a normal prompt to start. After success or failure, if any task across all Works in the current Pi session is active, the agent receives a message to continue and verify it. Legacy planned/pending task statuses restore as active. Empty Works and blocked, completed, or cancelled tasks do not cause another continuation. An active task that launched a command `MonitorCreate` with an `onDone` wake is excluded until that wake is delivered or dismissed, including while its notification is queued for idle. The exact task is captured at launch; Core `hcTerminalId` subscriptions and unrelated active tasks still continue. No task status is changed for that wait. Record genuine blockers and resume conditions in `blockedReason` with the required `dependentOn` classification when entering blocked status before handing off.

Press Escape/abort to stop. The extension will not restart from a monitor wake or another extension's message; send a new main prompt when you want it to resume. Failed runs do not disarm continuation: after native retries, unfinished records request another run until the 50-continuation limit is reached. Reloading or navigating session branches does not silently resume unfinished work; a tree change preserves the current count and requires fresh user input.

Auto-continuation is capped at 50 extra runs per fresh accepted main user run, including when `maxContinuations` is omitted. Add a positive integer such as `"maxContinuations": 10` to lower the cap; values above 50 are clamped to 50 with one visible warning. The final requested continuation is labeled final, and the next unfinished boundary warns with the count and hands control back without changing records. A fresh accepted main user run resets the limit; a rejected prompt, extension wake, session-tree change, or steering/follow-up input queued inside a running activity does not. Set `enabled` to `false` and reload to disable the feature. It checks recorded states, not whether every user requirement was captured or genuinely verified.

## Configure Open and Open Session

Both actions share `pi-tasks.openCommand` in global `~/.pi/agent/settings.json` (or your custom agent directory) or a trusted project's `.pi/settings.json`. For example, to use VS Code:

```json
{
  "pi-tasks": {
    "openCommand": ["code", "--new-window"]
  }
}
```

Merge this field into your existing settings, then run `/reload`. The array contains an executable followed by optional fixed arguments; the target directory is appended as a separate `.` argument, with the process working directory set to the repository/session directory or session artifact folder. For example, the setting above runs `code --new-window .`. Use `["cursor"]` for Cursor, `["zed"]` for Zed, or `["open", "-a", "Visual Studio Code"]` on macOS. Executable paths and arguments containing spaces belong in individual array entries; no shell quoting, expansion, pipelines, or command substitution is performed.

Omitting the setting retains `["cursor"]`. Empty arrays, blank executables, non-string entries, and NUL characters are rejected visibly without launching anything. The executable must be installed on PATH or specified by absolute path. Configuration requires a Pi host with `pi.getSettings()` (Pi 1.2.0+); older hosts retain the Cursor default. Trusted project settings override global settings through Pi's settings API. The floating panel, widget, `/works` Open/`o`, and `/works open|open-session` all use this setting. Open still targets the current session working directory; Open Session still locates or creates this agent's artifact folder.

## Work tools

```text
WorkCreate workName="Improve authentication" workInfo="Detailed context..."
WorkList
WorkList limit=10
WorkList workId="W1"
WorkUpdate workId="W1" workInfo="Updated shared scope and decisions..."
WorkDelete workId="W1"
```

Work tools do not accept `status`; `WorkList` filters by Work ID only. `WorkList` returns all matching works when `limit` is omitted. A positive integer `limit` selects the newest matching works after filters, displayed oldest-to-newest; every selected work still includes all of its todos. The result shows how many works were returned and how many matched in total. `WorkDelete` also removes associated todos.

## Todo tools

```text
TodoCreate workId="W1" taskName="Inspect token flow" taskInfo="owner: self — inspection and implementation." finalThoughts="Inspecting the token flow and call sites." completionPercent=0
TodoList workId="W1"
TodoList status="active"
TodoList workId="W1" limit=10
TodoUpdate taskId="T1" status="active" completionPercent=40 finalThoughts="Inspection is complete; implementation and verification remain."
TodoUpdate taskId="T1" status="blocked" dependentOn="another-agent" blockedReason="Waiting for the review findings. Resume when the reviewer returns them."
TodoUpdate taskId="T2" status="blocked" dependentOn="user-decision" blockedReason="Waiting for the user to choose the migration window."
TodoUpdate taskId="T1" status="completed" finalThoughts="The token flow is fixed; typecheck and build passed. Live provider behavior remains unverified."
TodoUpdate taskId="T2" completionPercent=null
TodoDelete taskId="T1"
```

`taskInfo` remains required for the hidden owner declaration and coordination metadata. `finalThoughts` is optional; send `finalThoughts=""` to clear it. A blocked task requires both `blockedReason` and `dependentOn`; the reason is its visible Final thoughts, and `dependentOn` accepts only `"user-decision"` or `"another-agent"`. Nonblocked tasks omit both; leaving blocked clears both. Completed tasks should include the short verified result, checks, and remaining limits in `finalThoughts`; a completion without one is accepted for historical callers but remains honestly empty rather than showing old narrative. Changing status clears an unsupplied thought.

`TodoList` returns all matching todos when `limit` is omitted. A positive integer `limit` selects the newest matching todos after filters, displayed oldest-to-newest. The result shows how many todos were returned and how many matched in total. Both list tools can still truncate very long text output at 50KB or 2,000 lines.

## Final thoughts

Final thoughts is the only task text shown in the compact native Tasks pane, the `/works` task detail, and copied Markdown. `taskInfo` stays stored for ownership, links, artifact paths, and resumption but is never rendered as task text.

- **Blocked:** `blockedReason` is authoritative and states what is awaited and what will unblock the task. Do not duplicate it in `finalThoughts`. Details show `Dependent on: User decision` or `Dependent on: Another agent` when the field is stored; a legacy blocked record without a reason or dependency shows no invented values and may fall back to an existing `finalThoughts`.
- **Completed:** state the short actual result, the verification performed, and any remaining limits. A newly completed task should provide this; historical completed records without it remain honestly empty. Do not synthesize an outcome from old `taskInfo`.
- **Active:** provide an occasional short update only when something significant changed. There is no required filler on every turn, estimate, or tool call.
- **Never include:** the goal again, delegation or ownership rationale, `owner:` declarations, terminal/monitor links, artifact paths, parent IDs, sections, lists, or history. Those belong in `taskInfo` or the owning workflow records.
- **Transitions:** changing status clears an unsupplied thought. This prevents an old active progress note from hiding a new blocker and prevents a resumed or completed task from showing a stale waiting message.

No length cap, summarizer, migration, or history mechanism is added. Stored records are not rewritten. The guidance is model-facing; only completed status and its 100% rule are enforced.

### Active task time

```text
TodoUpdate taskId="T1" status="active" working=true
TodoUpdate taskId="T2" working=true
TodoUpdate taskId="T2" working=false
```

The first call selects T1; the second pauses T1 and selects T2; the third pauses T2 without changing its status. `working=true` requires an active task with `owner: self` in its details. Creation and active status alone do not start timing. The model selects the task, but never submits timestamps or estimates of duration.

Time is saved total milliseconds plus `Date.now() - workingSince` while running. The extension saves each interval when paused, switched, or finished, not on every one-second display refresh. Thinking and foreground tool execution count. Idle periods, retry delays between agent loops, and blocking extension UI prompts pause timing. Blocking, completion, cancellation, changing away from self ownership, abort, and shutdown close the interval. Select again at the beginning of each new run. A restored session or branch always starts paused and excludes offline time. Abrupt process termination can lose the unsaved current interval; there is no background checkpoint writer. Blocking prompt exclusion requires a Pi host emitting `ui_prompt_start` and `ui_prompt_end`; older hosts retain loop-boundary timing.

The compact panel and `/works` show reserved Done and Time columns; `▶` beside a duration means it is running. New tasks show `0s`. Legacy tasks without timing show `—`; selecting one begins measurement from now, not from its creation date. Work time sums task effort, including cancelled tasks; any unknown duration makes its total unknown. This is not elapsed wall-clock time and does not predict completion. Each delegated agent times its own local tasks. Parent delegate records show `—` until the worker exports measured time and the parent imports it. Imported effort contributes to both the parent task and its Work, even while the parent task remains blocked. List tools and copied Markdown include durations too.

### Delegated timing

AgentCreate derives and creates the canonical parent task directory, then creates a unique `delegated-time-<id>.json` descriptor below it and returns its `reportPath`. Its prepared worker assignment includes export instructions; its monitor callback includes import instructions. Herdr still runs the worker and pi-loop-monitor still reports state changes. The timing file, not the notification or chat response, carries the measured values. Both agents need this version of pi-tasks loaded.

If startup fails after the worker exists, AgentCreate returns the same descriptor and handles with `status: partial`. AgentResume validates that descriptor through the delegation bridge before registering it: a fresh file with no worker session or tasks is a placeholder, not a measurement, and stays unknown until the worker's TaskTimeExport writes measured effort. A descriptor outside the canonical task directory or belonging to another parent assignment is rejected. Resume never writes or calculates elapsed time.

Before returning, the worker pauses or completes its assignment tasks and exports their timing:

```text
TodoUpdate taskId="T1" working=false
TaskTimeExport reportPath="<exact path from AgentCreate>" taskIds=["T1", "T2"]
```

Use worker-local IDs for every task in this assignment, including cancelled tasks. Exclude unrelated work. Durations are read by the extension; the model never supplies milliseconds. Import any nested delegates before exporting their containing task. Unknown nested or historical effort stays unknown. An export is a paused snapshot, not a live timer; work performed after export needs a new export.

After inspecting the worker output, the parent imports timing using its own task ID:

```text
TaskTimeImport taskId="T5"
```

Import leaves status and completion unchanged. The parent can remain blocked and still display measured worker effort. Import before closing the worker, so export failures can be corrected. Repeated imports replace the previous cumulative value. After follow-ups, the worker re-exports all previously included task IDs plus any new assignment tasks to the same file, and the parent imports again. A new AgentCreate on the same parent task registers an additional assignment source; its effort is added once, and unreported sources make the total unknown.

Report files contain parent IDs, worker session identity and task timing values, not task text or transcripts. They must remain under repository `var/`. A report binds to its first exporting worker session. Missing files, identity mismatches and malformed data produce tool errors; missing worker exports remain unknown rather than zero. Legacy/manual delegations without an AgentCreate report remain unknown. Existing imported totals survive reload and pane closure; newer worker exports only affect the parent after another explicit import. Older extension versions cannot show these imported totals. No polling, background timing registry, or changes to Herdr/pi-loop-monitor are involved.

### Completion percentages

During longer tasks, Pi should include a `completionPercent` estimate in `TodoUpdate` after roughly 5–10 meaningful working steps or a milestone, rather than waiting until completion or only updating status. Explain visible evidence in `finalThoughts` only when the change is significant; never use `taskInfo` for progress narrative. Estimates remain optional: use `null` when unknown, and leave a percentage unchanged if there is no new evidence. This is model-facing guidance, not an enforced schedule or an automatic percentage increase. These are approximate AI-reported values, not a fixed percentage for each status and not a time prediction. Use an integer 0–100 or `null` for unknown. Completed status means verified completion and displays 100%; 100 without completed status is rejected. Partial progress requires reopening a completed task; reopening without a fresh estimate makes it unknown. Blocking retains the current estimate.

Work progress averages all non-cancelled tasks equally and rounds down. Tasks at 100%, 40%, 0%, 0% produce 35% work completion, not 25% based on finished-task counts. If any eligible task lacks an estimate, the work displays `—`. No eligible tasks (an empty Work or only cancelled tasks) also means unknown. Work progress has no separate status or override. Existing sessions retain their records; legacy completed tasks display 100%, while other missing estimates remain unknown.

## TUI

Both the compact panel (floating or widget) and `/works` prefix work names with their IDs, such as `[W1] Locate subagent restrictions`. Task rows and dashboard detail headings also include ownership: `[T1] [self] Inspect the implement skill` or `[T2] [delegate] Implement storage`. These are display labels only; stored names and IDs are unchanged. Work IDs use the theme's accent color, task IDs use its type-highlight color, `[self]` uses success, `[delegate]` uses warning, and `[unassigned]` stays muted. Exact hues follow the selected theme; labels remain readable without relying on color.

Ownership is read case-insensitively from explicit line-start `owner: self` or `owner: delegate` declarations in hidden `taskInfo`, optionally followed by a reason or sentence. Incidental prose does not assign ownership. Missing, invalid, or conflicting declarations show `[unassigned]`; repeated declarations with the same valid value are unambiguous. No old records are rewritten and no new ownership parameter is required. Final thoughts never carries ownership. For example:

```text
owner: self. This is a small, tightly coupled change.
The task covers the panel label and its documentation.
```

### Delegate terminal links

A linked `[delegate]` badge uses `hc-terminal: <terminalId>` and `hc-monitor: <monitorId>` lines in hidden taskInfo. AgentCreate adds these and blocks the parent task after creation; TodoUpdate preserves them for delegate-to-delegate detail edits. Set `hc-terminal: none` to unlink, or use AgentClose. Historical herdr-pane metadata is inert, never guessed into a Core address. Opening a link uses normal herdr-app focus for a terminal that owns a pane or belongs to another machine. A pane-less Core child opens its own `terminal.peek` screen overlay over the current tab; it never navigates to the parent or reports a silent success. An address Herdr is not showing fails with an explicit error. These helpers classify from the desktop app listing and `hc get` and assume those commands target the same Core (`HC_SESSION`/`HC_SOCKET`); they do not perform Pet Town's `verified_world` cross-Core connection anchor, so isolated Core worlds are not independently matched.

The first completion of a linked delegate task adds a cleanup advisory to the `TodoUpdate` result. pi-herdr verifies the Core parent and `pi.session`/`pi.task` labels before appending it; no terminal from another session, task, or Core world is targeted. The advisory asks for a decision only: record a real follow-up as a blocked task with `dependentOn="another-agent"`, or verify the result, send `/close`, read `improvements.md`, import measured timing, and call `AgentClose`. It never acts on the worker and does not repeat while cleanup is handled.

## Agent tools

These tools are owned and registered by the separate [pi-herdr](https://github.com/abhishek944/pi-herdr) package, not pi-tasks. They are bounded, shell-free Core CLI wrappers; no legacy TUI fallback or pi-herdr-agents dependency. Creation/resume/closure require modern Pi nested tool calls and updated pi-loop-monitor.

| Tool | Purpose |
| --- | --- |
| `AgentCreate` | Verify the Core parent, start interactive Pi through hc, verify native idle status, register monitoring, and return terminalId/monitorId/reportPath plus a prepared assignment. `present: true` additionally adopts and verifies a dedicated visible task-named app tab and returns tabId. No assignment is sent. A post-launch failure returns `status: partial` with the same handles and an AgentResume next step. |
| `AgentResume` | Finish the same partial worker: validate the timing descriptor and task directory, prove Core parent plus `pi.task`/`pi.session` ownership, require idle Pi, reuse one ready subscription or replace a non-ready one, then attach timing/linkage. Never relaunches, duplicates monitoring, bypasses prompts or fabricates timing. |
| `AgentList` | `hc ls --json`, including unrelated live terminals. |
| `AgentStatus` | `hc get <terminalId> --json`. |
| `AgentOutput` | `hc read <terminalId> --lines <n>`, screen plus 50 history lines by default, up to 200. |
| `AgentSend` | `hc send <terminalId> <message>`, without --wait or --force. |
| `AgentInterrupt` | `hc keys <terminalId> esc`. |
| `AgentClose` | Stop the supplied monitor when present, kill the owned terminal if live, then remove its finished Core record. A partial worker with no monitor can be closed with only terminalId. If the worker was presented, the app removes its ended pane/tab. |
| `AgentFocus` | Shows an existing Core agent through herdr-app. A pane owner or another machine's terminal uses `agent.focus`; a pane-less sub-agent uses `terminal.peek` to open its own screen overlay over the current tab. Also used by delegate links. Reports `focused: false` with a reason when no app is available or the agent cannot be shown. |

pi-herdr 0.1.0 requires the compatible local pi-tasks source with the version-1 prepare/inspect/attach/detach event-bus bridge. Published pi-tasks 0.15.0 lacks this bridge and owns legacy Agent tools; replace that source, do not load it alongside the updated local package. Reload or restart Pi after installing the coordinated pair. pi-tasks keeps timing, records, delegate links and task UI helpers. pi-herdr rejects duplicate Agent names with migration instructions rather than overriding them.

For an existing active Work/Todo with owner: delegate:

```typescript
AgentCreate({
  workId: "W1", taskId: "T2",
  // parentTaskDir: "<exact parentTaskDir from your assignment>", // delegated workers only
  // present: true, // optional: adopt the worker into its own visible task-named app tab
  assignment: "Review the approved change. Do not edit files or run tests.",
  provider: "<chosen-provider>", model: "<chosen-model-id>", thinking: "high",
  onSignal: "Inspect actual worker output and blockers before completing its task.",
  onDone: "The subscription ended. Inspect MonitorList and recover monitoring if needed."
})
```

AgentCreate derives the canonical task directory from the host session and real Work/Task IDs and creates it if absent. A root session omits `parentTaskDir` and gets `var/<sessionId>/<workId>/<taskId>/`; a delegated session passes the exact `parentTaskDir` from its assignment and gets `<parentTaskDir>/<sessionId>/<workId>/<taskId>/`. Do not read the session ID or create the directory just for AgentCreate. Direct hc CLI launches still prepare the path manually.

The wrapper verifies the real HC_TERMINAL_ID with hc. It launches Pi with explicit model flags, an explicit parent, and --no-notify (the existing monitor supplies wakes). Core-only creation needs no app. With `present: true` it first locates the parent's app space by terminal mapping, never UI focus, and fails before launching when that space is missing; it then adds a herdr.space label without herdr.tab to request a new visible tab, checks that it contains only the worker, renames it to the parent's Task ID, and verifies that mapping. Missing Core prerequisites, or an unavailable app space when presentation was requested, fail clearly; HERDR_ENV is not required. Workers end with their parent by Core's default policy.

The timing descriptor and prepared assignment retain worker-local tracking, canonical nested artifact paths and TaskTimeExport/Import. AgentCreate returns the resolved taskDir and assignmentSent:false. Confirm MonitorList shows `Core signal subscription ready for <terminalId>`, then call `AgentSend({ terminalId, message: assignment })`. Retain that subscription for follow-ups. onSignal means worker state changed; onDone means the subscriber process ended, not task completion. Read output/files and import measured effort before accepting work.

Use actual returned terminal addresses (t7 or machine/t7), not app pane IDs or tab names. A startup failure reports partial handles without blind relaunch, retries or automatic cleanup. Close only resources you created after their results are accepted. No registry or recovery runtime is added.

Linked delegate badges are underlined and clickable in the compact panel, widget, dashboard and detail headings when fully visible. In /works use d; /works delegate T<number> works in regular mode too. Navigation uses herdr-app: a pane owner gets focus, while a pane-less Core child opens its existing terminal.peek overlay over the current tab without navigating to the parent. Unavailable app/CLI, closed targets, or a terminal Herdr is not showing report errors. No subprocess runs while rendering. Without a valid Core link, badges remain informational. Open actions remain unchanged.

The compact panel no longer displays the session ID. Before Copy, its header shows nonzero task-state counts across all Works: `3!` blocked, `2▶` active, `5✓` completed, and `1×` cancelled, using the same icon colors as task rows. Counts update in floating, widget and minimized layouts; narrow headers shorten the toggle and truncate the summary when needed. Its underlined `[Open session]` action sits immediately after Copy in floating, widget and minimized layouts. It opens this agent's existing artifact directory under repository `var/` using the configured command, including a nested delegated session folder. If no folder exists, it creates `var/<full-sessionId>/`; multiple matching folders report an ambiguity rather than guessing. Session identity comes from Pi's context, not a pane name. Folder resolution and command launch happen only on activation, never during rendering. `/works open-session` is the keyboard-command alternative. The existing Open action still opens the repository. Narrow compact headers use `[-]`/`[+]` for Minimize/Maximize so all actions fit. The `/works` dashboard retains its existing title and controls.

The compact TUI is off by default. When enabled, its default layout floats at the top-right without taking keyboard focus. Its minimum box width is 48 columns to leave room for names beside both metrics; the widget hides below 48 columns. Separated right-hand Done and Time columns keep work/task percentages and measured durations aligned and visible even when names are long; the left side retains names, task status icons and Work task-counts. Work rows have no status icons. It hides on small terminals. The top border centers repository-wide Git status: `git main · S2 U3 ?1` means two staged files, three unstaged files, and one untracked file; a file with both staged and unstaged edits counts in both. A clean repository shows `git main · clean`. Long branches shorten before counts. Detached HEAD shows `@` plus the short commit. Git remains visible while minimized and adds no content row.

The asynchronous Git cache refreshes every second while a view is attached; file-changing tool results expire it sooner without blanking the last snapshot. Initial reads show `git loading…`; outside Git the border is plain, and initial failures show `git unavailable`. Later refresh failures retain the last snapshot until a successful read. Polling is read-only and stops when both the panel and dashboard are closed/off.

In fullscreen TUI mode, click Copy in its title bar to copy every work and todo as Markdown, Open to run the configured command in the current session directory, or Minimize to collapse the panel to a small title bar. Copy and Open remain available while minimized, and Maximize restores the rows. The configured executable must be on PATH (or be an absolute path); launch failures produce visible error feedback. When more rows exist than fit, the floating panel starts at the newest rows; move the mouse over it and use the wheel to scroll older or newer rows without taking focus from the editor. In regular terminal mode, open `/works` to browse and copy the complete list.

Use `/works minimize`, `/works maximize`, `/works open`, or `/works open-session` when mouse input is unavailable. Use `/works widget` for a right-aligned layout above the editor that renders every row and retains the clickable title actions, `/works floating` to return to the floating layout, `/works compact-off` to hide it, or `/works compact-on` to restore the last visible layout. `/works herdr-on` installs missing bundled mod files and opens the native Tasks pane; `pi-tasks.herdrPanel.enabled` opens it at each session start.

Run `/works` for full details. Its top border mirrors repository-wide Git status, and its top bar includes Copy, Open, and Minimize actions. In fullscreen TUI mode, click Minimize to collapse the dashboard to a top bar showing the current work and todo totals; click Maximize to restore it. The actions also have keyboard shortcuts that work in regular terminal mode.

- `c`: copy all works and todos as Markdown
- `o`: open the current repository/session directory using the configured command
- `d`: open the selected task's linked delegated agent
- `m`: minimize or maximize the dashboard
- Fullscreen left click: activate header actions, or click a task/work row to open its full details. Clicking a linked delegate badge still opens its agent.
- Configured Up/Down keys: select in the list; scroll in details
- Configured Page Up/Page Down keys: page through the list or scroll long details
- Configured confirmation key: open the selected record's full detail view
- Back to works or configured cancel key: return from details to the task list without losing your place
- Configured cancel key from the task list: close `/works`

The full task view shows its name, parent work, status, completion, measured time and full task information. Final thoughts carries any stored dependency beside its heading, such as `Final thoughts · Dependent on: Another agent`; blocked tasks show **Reason:** followed by the blocker text on the same line, wrapping as needed, before the task information. The mouse wheel scrolls long details. Escape from details returns to the task list; Escape again closes the dashboard.
