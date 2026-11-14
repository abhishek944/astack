# pi-schedulers

Scheduled Pi runs hosted by the Herdr desktop app: a prompt, a folder, an
interval or a wall-clock time, and a fresh persistent Pi session per run.

The scheduler runs **only while the Herdr app is running**, because the clock
lives inside a mod. There is no daemon, no login item and no launch agent.
Quitting Herdr (`Cmd+Q`), or the machine going to sleep or off, stops it.

**Known limit (Herdr 0.1.12).** On macOS the red close button *hides* the app
instead of destroying the window (`herdr-app src/window.rs`: `cx.hide(); return
false`), and Herdr exposes no mod-visible "window closed or hidden" signal —
`window().active` is platform focus, and mod timers keep ticking in a hidden
window. So a hidden window is still a running Herdr, and scheduling continues.
Closing the window does not stop runs; quitting the app does. See
[Lifecycle limits](#lifecycle-limits).

## What you get

- A **Schedulers** entry in Herdr's top row, beside Files and Changes.
- A **right-side panel**, in the same slot as Files and Changes, with every
  task's schedule, next run, last status and
  error, plus **Run now**, **Edit**, **Pause/Resume**, **Delete** and
  **Open run**.
- An editor inside that panel: name, prompt, folder, workspace (project folder, existing
  worktree, or a new worktree with a base branch), interval or fixed local time
  with weekday buttons, real searchable configured-model and thinking dropdowns,
  and Enabled as the final fifth point on a continuous planning rail. Cancel returns to the
  list without saving; switching to Files/Changes keeps an unfinished draft.
- A **Schedulers space** holding one tab per run. Runs are adopted with
  Herdr's own `herdr.space` / `herdr.tab` labels, so starting work never yanks
  your current view away.
- `/schedulers` in Pi for listing, pausing, deleting and asking for a run now.

## Create from a First Mate coordinator

When pi-firstmate is installed and effectively on in a coordinator session,
`SchedulerCreate` is available for **explicit human requests to schedule work**.
It is hidden with First Mate absent, off, worker-suppressed, or default-suppressed
by an uncertain Core lookup. First Mate's existing explicit `/firstmate on`
handling remains authoritative even after an inconclusive lookup. It
must never be called proactively, autonomously or from inferred permission.

The scheduler package owns the tool and always shows the complete resolved
name/prompt, folder/workspace, schedule/local timezone/estimated next run,
model/thinking/enabled state, and normal tools/MCP with First Mate off. A human
must choose **Create** or **Cancel** for every call, including duplicates. The
TUI preview scrolls with arrow/Page keys; Tab or left/right chooses the action,
Enter accepts, and Escape cancels. Cancel is selected initially. RPC uses its
supported human dialog. No UI, abort, cancellation, read-only `/ask`, or a mode
change while confirmation is open prevents saving. Turning off and back on
also invalidates that open confirmation. There is no model-supplied approval
or tools parameter; this is a human gate, not a proof of intent from model claims.

Required: `name`, `prompt`, `schedule`. Schedule is either
`{type: "fixed_time", timeOfDay: "09:00", weekdays?: [0,1,2,3,4,5,6]}`
(local time; Sunday is 0, omitted/empty means daily) or
`{type: "interval", everyMinutes: 0.5}` (positive, including fractions).
Optional: `folder` (absolute, defaults to Pi cwd), `workspace` (defaults to
`{mode: "root"}`; also `{mode: "existing", path: "/absolute/checkout"}` or
`{mode: "worktree", baseBranch: "main"}`), `model`/`thinking` (Pi defaults),
and `enabled` (true). New worktree destinations are generated at dispatch,
not during preview; interval next-run previews are estimates recalculated at save.

Creation saves only the definition through the existing transactional store. It
does not execute the prompt, create a worktree, install the mod, request run-now,
or grant project trust/authentication. Enabled definitions can dispatch when
due while Herdr runs. After updating both packages, reload Pi when safe; do not
reload while preserving an unsaved native scheduler form.

## Install

```sh
cd packages/pi-schedulers
npm install
npm run build
./bin/pi-schedulers.js install
```

`install` copies the mod into `<Herdr app home>/mods/pi-schedulers`, creates the
store under `<Herdr app home>/data/pi-schedulers`, and puts a `schedulers-bar`
block in the same row as the app's tab bar plus a `schedulers` child in the
existing native `panel-body` stack. The button selects or closes that same
panel; it does not open a floating dashboard. The native Files/Changes buttons,
per-space selection and panel width remain unchanged. A layout without that
native stack is reported as unsupported, not given an overlay fallback.
It keeps a timestamped backup of the layout file and refuses to touch Herdr's shipped layouts (`main`,
`terminals`, `win98` are replaced on every app start; clone one first). It
migrates a store written by the first build, and runs `herdr-app check`
afterwards, the app's own mod load test.

From inside Pi, `/schedulers install` does the same thing.

The Herdr mod and the Pi package are separate registrations. Register the
package so new Pi sessions load its extension (and therefore
`SchedulerCreate`):

```sh
pi install ./packages/pi-schedulers   # from the repository root
```

Or add the same package path to the `packages` array in
`~/.pi/agent/settings.json`. A local package is loaded from that path; no copy
is made. A session that is already running needs `/reload` or a restart before
the tool appears. Do not reload while preserving an unsaved native scheduler
form.

## Requirements

- Herdr 0.1.12 or newer (the mod API used here).
- **Pi 1.4.0 or newer** for the supported configured-runtime and trust metadata
  boundary. The dispatcher verifies the resolved Pi version before launch.
- The package requires `@earendil-works/pi-coding-agent >= 1.4.0` for public
  configured-model runtime services. The scheduled-launch compatibility check
  above remains unchanged.

## Why there is no service

A Herdr mod is a program inside the window's layout. The always-shown bar copy
starts the clock when the layout shows it; the panel and its editor never
start one, because Herdr evaluates a mod's module once per loaded copy and only
the bar owns dispatch. Multiple bar owners share the same per-task transaction
lock with authoring commands.

- Quit, crash or power off: no bar copy is alive, so nothing ticks.
- Two app windows: each may tick; exclusive creation of `locks/<taskId>.json`
  protects the current-state decision through launch acceptance and result save.
- App reload/crash mid-dispatch: **automatic interrupted-owner recovery is not
  supported**. A lock never expires, and a `running` record is never reclaimed
  by age. Inspect a persistent lock/unfinished run only after all scheduler
  owners are stopped and launch acceptance is known; see the usage guide.
- Edit, Pause, Delete and Run now refuse explicitly while that task's
  transaction is busy. Retry after dispatch; a rejected action changed nothing.

## Scheduled runs and permissions

Each run is a new persistent Pi session, outside First Mate coordinator mode:

```sh
pi --session-id sched-<stamp>-<hex> --name "<task>" \
   [--firstmate-worker] [--model <provider/model>] [--thinking <level>] \
   -- "<prompt>"
```

The supported `--firstmate-worker` marker is included when normal resource
discovery actually registers it. Each run keeps Pi's normal configured tools,
extensions and MCP; the scheduler no longer passes a built-in allowlist,
`--tools`, `--no-mcp` or a trust override. Legacy task `tools` data is retained
for compatibility but does not restrict execution.

The actual run folder is checked through Pi's public trust store and existing
default policy before launch. Already-trusted project resources stay available.
If protected resources lack an existing affirmative grant, the run fails with
an explicit trust-required error instead of prompting unattended, silently
stripping resources or granting trust. Open Pi in that run folder and establish
the intended trust decision yourself, then retry. The scheduler never writes
trust decisions or changes global defaults. Normal Pi authentication and custom
extension trust policies remain in force; all tools does not mean bypassing
those boundaries.

Worktrees are created with `git worktree add -b schedulers/<task>-<id>` under
`~/.herdr/worktrees/<repo>/<branch>`, the same root Herdr's own worktree mod
uses. Successful worktrees are never deleted.

The first time a run needs the Schedulers space it is created as an ordinary
space (one shell tab named *Schedulers*); the run is only marked accepted once
the launch itself returns, so a failed launch is recorded as a failure rather
than a success.

## Schedule semantics

| Case | Behaviour |
|---|---|
| Interval | next run = launch acceptance + interval; never aligned to a grid; no minimum interval |
| Fixed time | next local occurrence strictly after the reference instant; weekday set, `0` is Sunday, empty means daily |
| Missed fixed run | more than 10 minutes late: skipped and re-aimed at the next occurrence |
| Overdue interval | one catch-up run, then the new interval from acceptance |
| Overlap | one dispatch per task at a time; the guard ends at launch acceptance, not when the agent finishes |
| Interrupted launch | no automatic replay or recovery; a persistent lock or unfinished run requires operator inspection after all owners stop |
| Editing | a prompt, model or tool change never moves `nextRunAt`; a schedule or enabled change re-aims it |
| Daylight saving | a wall time that does not exist moves forward by the gap; a repeated wall time takes the earlier instant |

## Lifecycle limits

Verified against the installed Herdr 0.1.12:

- The macOS red button calls `cx.hide()` and returns `false`, so the window and
  its mods stay alive. Herdr does not throttle mod timers for a hidden window
  (`gpui-kit` shell scheduler: "throttling an invisible window [is left] to host
  policy; this implementation keeps ticking").
- `window()` exposes `{platform, titlebar, buttons, maximized, fullscreen,
  active}`; its `active` is `Window::is_window_active`, meaning platform focus.
  A hidden app and a merely unfocused app look identical there, so gating on it
  would stop scheduling whenever you switched to another app.
- `View.close` runs when a pane, tab, layout slot, overlay or the app goes —
  not on hide.
- No host command, shared key, settings field or file records visibility.

So with the supported API surface the scheduler can be exactly "while Herdr is
running", not "while a window is visible". Closing the window is not a stop
condition; quitting the app is. A future Herdr that exposes a visibility or
app-hidden signal to mods would let this package gate on it without any other
change.

## CLI

```sh
pi-schedulers list
pi-schedulers models --json --folder ~/code/app # offline configured chat metadata
pi-schedulers add --name "Nightly deps" --prompt "Update and test" --folder ~/code/app --at 09:00 --days mon,wed
pi-schedulers add --name "Triage" --prompt "Check the issue queue" --folder ~/code/app --interval 45m --model openai-codex/gpt-6.1-sol
pi-schedulers run "Nightly deps"
pi-schedulers pause "Nightly deps"
pi-schedulers state
```

`run` records a request for the running app and refuses when no window answers,
because dispatching is the app's job. It also refuses while a dispatch or another
mutation owns the task, while a prior request is pending, or when an unfinished
`running` record needs inspection; accepted requests are not silently dropped.

## Limits worth knowing

- One local store, one Herdr app home. `HERDR_APP_HOME` (or `--app-home`)
  selects a different home, and therefore a different store.
- Scheduler management shares the native Files/Changes right panel; runs live
  in the Schedulers space. Closing or switching that panel does not stop the clock.
- Bound-thread queueing, webhooks, retention policies and automatic worktree
  cleanup are not implemented.

See `docs/USAGE_GUIDE.md` for the day-to-day flow and `docs/REFERENCE.md` for
the store format, CLI flags, concurrency rules and module boundaries.
