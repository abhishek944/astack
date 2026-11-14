# pi-schedulers reference

## Lifecycle

| Fact | Where it comes from |
|---|---|
| A mod copy starts when its block first shows, stays alive while hidden, and gets one bounded `close` when its pane, tab, layout slot or the app goes | Herdr's installed guide (`AGENTS.md`) |
| Herdr evaluates a mod's module once **per loaded copy**, so module scope is not shared between the bar and a dashboard copy | herdr-app `vendor/gpui-kit` shell engine (`?v=<generation>` module names) |
| Mods may not use `setTimeout`; the timer is `cx.timer` on the copy's context, and it keeps ticking for a hidden window | `gpui-kit` shell scheduler §12.5 |
| The macOS red button hides the app (`cx.hide(); return false`) instead of destroying the window | herdr-app `src/window.rs` (v0.1.12) |
| `window().active` is `Window::is_window_active`, i.e. platform focus — not visibility | `herdr.d.ts`, `gpui-kit.d.ts` |
| The Herdr app home is `HERDR_APP_HOME`, else `$XDG_CONFIG_HOME/herdr-app`, else `~/.config/herdr-app` | `herdr-app --help`, `herdr.d.ts` |
| Mods read anywhere under the user's home and write only under the app home; `fs/promises` offers `readFile`, `writeFile`, `readdir`, `exists`, `unlink`, `rmdir`, `mkdir` | `AGENTS.md`, shell `standard/fs.rs` |
| `writeTextFile(..., null)` uses OS `create_new(true)`; existing-file saves check expected bytes and atomically replace, but are not cross-process CAS | `herdr.d.ts`, tagged v0.1.12 `src/mod_files.rs` |
| The running app grants a mod reads under `$HOME` and writes under the app home; `herdr-app check` grants only the mod folder and the manifest's `capabilities` | herdr-app `src/mods.rs` (`prepare_load`), shell host `grant_local_access` |
| `hc run --bg` starts a program and returns at once; `--label herdr.space=` / `herdr.tab=` adopt it into a tab | `hc --help`, `AGENTS.md` |

What follows from those:

- **The bar is the only owner.** The panel and its editor are authors and
  readers; their refresh timer never dispatches or recovers a run.
- **No backend process.** The clock is the bar's timer, so "Herdr is running"
  and "the scheduler ticks" are the same fact. Quit, crash and power-off stop
  it; there is nothing to supervise and no login service.
- **Hide is not close.** On macOS the red button hides the app, mods stay
  alive, so scheduling continues. There is no supported signal that tells a
  hidden window from an unfocused one, so this package cannot stop on close
  without an upstream capability. See the README's lifecycle limits.
- **Cross-window safety.** A per-task exclusive-file lock serializes every
  mutation, including the complete dispatch decision through launch acceptance.
  No owner is replaced by age or by another copy's cached state. Automatic
  recovery of interrupted owners is unsupported without a host liveness boundary.

## Files

```
<Herdr app home>/
  mods/pi-schedulers/          main.js, mod.json, clock.svg, core/*.js, README.md
  data/pi-schedulers/
    tasks/<taskId>.json        the definition; written by the form, CLI and extension
    state/<taskId>.json        run state: dispatch transitions, plus pause/resume and run-now
    locks/<taskId>.json        exclusive transaction owner; never expires
    claims/<taskId>.json       legacy files, retained but no longer used
  layouts/<active>.json        gains two blocks:
                               schedulers-bar: pi-schedulers, slot: bar (persistent top row)
                               schedulers: pi-schedulers, slot: panel (native panel-body child)
```

`layouts/<active>.json.bak-<timestamp>` is written before the layout edit. A
shipped layout (`main`, `terminals`, `win98`) is never patched in place: Herdr
restores it on every start, so the installer refuses and prints the clone
command. The personal layout must already have native `panel` / `panel-body`
with Files and Changes; missing/conflicting nodes are reported without a
floating fallback. Bar-only installs gain the missing panel child. The native
stack's selection, panel hidden state and sizes are preserved. A legacy
`data/pi-schedulers/state.json` from the first build is
migrated into per-task files once and kept as `state.json.migrated-<stamp>`.

## Right-panel integration

The top button reads `layout()` and uses `layout.select({stack:'panel-body',
child:'schedulers'})` then `layout.show({id:'panel'})`, or hides `panel` if
Schedulers is already selected. It highlights only while its panel is shown.
Native `mods/tabs/main.js` retains all Files/Changes controls and per-space
restoration. The bar appends `schedulers` to `workspace.panels` without changing
other enabled entries, making the native restoration logic accept that choice.
The header has named New task and Open space icon buttons; the top Schedulers toggle hides the column. There is no Close button or dashboard bottom status/lifecycle segment. Panel sizes are not reset.

The panel locally switches between list and editor. Input states and the
original task-definition bytes are initialized only on New/Edit, not background
refresh; Save uses the same original-snapshot transaction. Hiding or selecting
another stack child leaves the draft alive. The bar is outside that stack, so
none of these changes stop or duplicate dispatch. Restored legacy overlays close
themselves; no new main scheduler overlay is created.

## Configured model and launch metadata

`pi-schedulers models --json --folder <path>` uses public Pi 1.4 runtime
services, restores only local catalogs with `PI_OFFLINE=1`, and returns chat
provider/ID/name metadata, real default/scope and a typed launch-policy result.
Normal global and already-trusted project provider factories are loaded. It
does not create/bind a session, fire session_start, connect MCP, run a prompt,
resolve request auth, refresh OAuth or request remote catalogs. Trusted
extension code is executable; offline mode is not an arbitrary-code sandbox.

Project readiness uses exported `ProjectTrustStore` and
`hasTrustRequiringProjectResources`, plus the existing global default. A
protected folder without an affirmative saved/parent grant or existing
always-trust default reports trust-required. The scheduler never writes trust
or passes --approve/--no-approve. Pi's custom extension trust/auth policies
remain normal startup policy.

The installer writes `mods/pi-schedulers/host.json` with this package's Node/CLI
paths. One native helper consumes that boundary for the editor and for the
actual prepared run folder before hc launch. Launch metadata reports whether
normal discovery registered the boolean firstmate-worker flag; only then is
--firstmate-worker passed. The existing per-task lock and failure transition
own a failed preflight. New-worktree preparation still precedes this actual-
destination check; a rejected preflight may leave the prepared checkout, just
as any other pre-launch failure can.

Search only filters real metadata. Pi default is intentional, existing
unavailable selections remain unchanged, and discovery never gates unrelated
unchanged-value saves. Loading, error/Retry, no configured models,
no-match/Clear search and cached-refresh failure are distinct source states.
The result list has no application-defined item cap. Legacy task.tools remains
stored and validated for format compatibility but is never passed as a launch
allowlist. All normally configured tools/extensions/MCP remain available,
subject to their own real configuration, exposure, auth and trust boundaries.

## SchedulerCreate tool and First Mate protocol

`create-tool.ts` owns `SchedulerCreate` and its closed TypeBox schema. Required
fields are `name`, `prompt`, `schedule`; optional fields are `folder`, `workspace`,
`model`, `thinking`, `enabled`. There is no `tools`, `confirmed`, `userTriggered`
or other approval argument. Fixed times use local `HH:MM` with optional weekdays
0–6; positive fractional `everyMinutes` intervals become the core's `everyMs`.
Defaults are current Pi cwd, root workspace, Pi model/thinking and enabled true.
Paths are checked/resolved read-only before preview; no worktree is provisioned.

The tool is registered hidden by default, with `defaultActive: false`. A live
scheduler queries `pi-firstmate:mode:probe` synchronously for
`{available: true, protocolVersion: 1, effective, generation}`. The answer comes
from First Mate's authoritative `resolveMode().effective`; model arguments,
configuration defaults alone and banner files cannot authorize creation. A
`pi-firstmate:mode:changed` notification triggers a fresh probe and scheduler-owned
re-registration as hidden/model-only. Dynamic registration snapshots and restores
the exact prior active-tool list before publishing any change: Pi's registry refresh
can otherwise reapply unrelated CLI `--tools` matches. First Mate alone adds the
scheduler's activation. `pi-schedulers:tools:changed` lets First Mate
inspect the real installed registration via `getAllTools().sourceInfo`, allow its
package, and activate only its actual model-only registration. No private imports,
shared dependency instance, guessed foreign names, polling or IPC are involved.
Factory registration is hidden, either session-start order works, and shutdown
hides it again. First Mate excludes coordinator-only scheduler registrations from
all baseline capture/restoration. `/ask` is not widened and is rechecked at execute.

`create-confirmation.ts` shows the complete resolved preview with Cancel selected
initially, keyboard-scrollable full text in TUI and the supported select dialog
in RPC. It always waits for an actual human Create/Cancel decision. Absence of UI,
Cancel/Escape, abort, read-only mode or effective-mode generation change before
commit initiation prevents creation. Every duplicate call needs a new confirmation.
This is a human gate, not a claim that model prose can prove user intent.

Before preview, existing `buildTask` validates the definition. After human Create,
the tool rechecks mode/abort then passes that same previewed task to `saveTask`.
A narrow optional synchronous `saveTask` guard runs before I/O and before the
atomic definition's temporary write and rename initiation. A rejection cleans up
its existing lock/temp files; no schedule/worktree/job is created by a cancelled
dialog. Once rename has been issued, a later mode change cannot atomically revoke
that filesystem commit; state completion stays with the existing transaction.
The scheduler returns only safe status/id text, not raw filesystem/auth errors or
the full prompt. An uncertain save failure asks for inspection rather than retry.

The preview identifies model/thinking defaults as resolved at scheduled-run
startup, estimates next run at save, and states normal tools/extensions/MCP with
First Mate off and unchanged project trust/auth. Creation never launches work,
requests run-now, installs a mod or grants trust/auth. Enabled definitions can be
dispatched when due by the existing Herdr clock.

## Store files

`tasks/<id>.json`

```jsonc
{
  "id": "task-20261106153000-ab12cd34",
  "name": "Nightly deps",
  "prompt": "Update dependencies and run the tests.",
  "enabled": true,
  "folder": "/Users/me/code/app",
  "workspace": { "mode": "root" }
    // | { "mode": "existing", "path": "/abs/checkout" }
    // | { "mode": "worktree", "baseBranch": "main" },
  "schedule": { "type": "interval", "everyMs": 2700000 }
    // | { "type": "fixed_time", "timeOfDay": "09:00", "weekdays": [1, 3] },
  "model": "openai-codex/gpt-6.1-sol",
  "thinking": "medium",
  "tools": ["read", "bash", "edit", "write", "grep", "find", "ls"],
  "createdAt": 1770000000000,
  "updatedAt": 1770000000000
}
```

`state/<id>.json`

```jsonc
{
  "nextRunAt": 1770002700000,
  "lastRunAt": 1770000000000,
  "lastRunStatus": "succeeded",   // "running" | "succeeded" | "failed" | null
  "lastRunError": null,
  "lastRunId": "sched-20261106-153000-ab12cd34",
  "lastSessionId": "sched-20261106-153000-ab12cd34",
  "lastFolder": "/Users/me/code/app",
  "lastTabId": "tb0f1e...",
  "lastTabName": "Nightly deps · Nov 6 15:30",
  "runCount": 4,
  "runRequestedAt": null,
  "scheduleKey": "on|{\"type\":\"interval\",\"everyMs\":2700000}"
}
```

- `scheduleKey` records which definition `nextRunAt` came from. If a save moved
  the schedule but could not update the state file, the dispatcher re-aims on
  its next load instead of firing at a stale instant.
- `parseTask` and `parseState` are per file: one unreadable task is reported in
  the dashboard and skipped, the rest keep working.

## Concurrency rules

| Writer | Files it writes |
|---|---|
| Bar (dispatcher) | `state/<id>.json` for dispatch transitions; holds `locks/<id>.json` |
| Dashboard / editor | `tasks/<id>.json`; `state/<id>.json` for schedule/enabled changes and run-now; same lock |
| CLI / `/schedulers` | the same two, for the same operations |

- All supported writers acquire the same `locks/<id>.json` before reading the
  current record and keep it through their complete decision and writes. Node
  uses `writeFile(..., {flag: 'wx'})`; the mod uses `writeTextFile(..., null)`.
  Exclusive creation, not a read-then-rename, decides ownership.
- Node temp+rename provides atomic file replacement *inside* that lock. The mod
  retains expected-byte writes too. Neither retries stale desired state with
  newer expected bytes. Hand-editing files while an owner is active is outside
  this protocol and unsupported.
- Authoring compares the current definition with the snapshot that the author
  actually read. A stale/deleted definition is refused. Runtime state is loaded
  afresh under the lock; prompt-only saves leave unchanged runtime files alone.
  Schedule state is derived from the untouched previous definition.
- The dispatcher rechecks enabled/deleted/running/due/request identity under
  the lock. It retains exclusive ownership through prepare, launch and result
  save. Pause/Delete/Run now during this interval are explicitly rejected as
  busy rather than accepted and lost. A pending request is not accepted twice.
- Locks have no lease or timeout and are never stolen. Sleep cannot make a live
  owner appear dead. A crash/reload can leave a lock or unfinished `running`
  state; automatic interrupted-owner recovery is explicitly unsupported.
  Inspect and repair only after all owners stop and acceptance is checked;
  do not infer failure from elapsed time. Legacy claims are not used to recover.

## Dispatch sequence

1. Load candidates without recovering any `running` record by age. Missed
   fixed runs are re-read and re-aimed under their task lock.
2. Acquire the candidate's exclusive task lock. Busy owners are skipped, never
   replaced. Re-read current task/state; require enabled, not `running`, and the
   same due/request instant, still due now. A deleted/paused/moved task is skipped.
3. The Schedulers space must exist. If absent, await `herdr-app do space.new`;
   a nonzero reply or missing accepted space id is reported as a failed
   dispatch. Clear pending state in finally even on rejection. Use the returned
   `space` id, which the host supplies only after spawn and add_space succeed.
4. Resolve `pi`: the login shell's binary plus `pi --version`. Require the
   supported Pi 1.4 configured-runtime boundary, matching the package peer.
5. Keep the task lock throughout the following steps; no separate reclaimable
   claim or claim-to-begin gap exists.
6. `beginRun`: write `lastRunStatus = running` to this task's state file — the
   durable second guard.
7. Prepare the folder: root, existing path, or `git worktree add -b
   schedulers/<slug>-<id> ~/.herdr/worktrees/<repo>/<branch> <base>`. Inspect
   existing project trust and the supported First Mate marker for that actual
   destination. An unmet grant is an explicit pre-launch failure, not a prompt,
   silent resource stripping or an automatic trust grant.
8. Launch: `hc run --json --bg --no-parent --keep --cwd <folder> --name <slug>
   --label herdr.space=<space> --label herdr.tab=<tabId> -- <pi argv>`, and
   check its exit status. **This** reply is the acceptance.
9. `finishRun` at acceptance: `succeeded`, `nextRunAt` advanced from the
   acceptance instant, `runCount + 1`, session id, folder, tab id and tab name
   recorded. The Pi turn may still be running.
10. A rejected pre-acceptance operation → `failRun`: `failed`, message kept,
    next run advanced, nothing replayed. A failed result save is surfaced; an
    accepted launch is never relabeled as a pre-launch failure. Release the
    task lock in finally. Process interruption before release requires manual
    inspection, never timeout reclamation.

## CLI flags

| Flag | Meaning |
|---|---|
| `--name <text>` | Task name (required on `add`) |
| `--prompt <text>` | Prompt for the run (required on `add`) |
| `--folder <path>` | Absolute folder (required on `add`) |
| `--interval <15m\|90s\|2h\|N>` | Interval; a bare number is minutes |
| `--at <HH:MM>` | Fixed local time |
| `--days <mon,tue\|1,3,5\|weekdays\|weekends\|daily>` | Weekday set for `--at` |
| `--workspace root\|existing\|worktree` | Workspace mode |
| `--existing <path>` | Checkout for `existing` |
| `--base <branch>` | Base branch for `worktree` (default `main`, empty means `HEAD`) |
| `--model <provider/model[:thinking]>` | Pi model selection |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--tools <a,b,...>` | Legacy stored metadata only; no effect on launch tool availability |
| `--enabled` / `--disabled` | Initial or edited state |
| `--app-home <path>` | Use a different Herdr app home |
| `--json` | Machine output |

## Module boundaries

| Module | Owns | Never does |
|---|---|---|
| `core/schedule.ts` | Schedule shape validation, next-run math, 10 minute grace, labels | I/O, clock reads |
| `core/model.ts` | Task/state types, the single validation boundary, per-file parse/serialize, the minimum Pi version | I/O |
| `core/transitions.ts` | Pure state transitions, applied to current state under the task lock | I/O, timers, liveness inference |
| `core/run.ts` | Run ids, session ids, Pi argv, `hc` adoption args, worktree branch/path | I/O |
| `host/paths.ts` | App home and store locations | Other state |
| `host/store.ts` | Listing and shared-lock task mutations; current-state save/change transitions | Timers, dispatch, owner-death inference |
| `host/install.ts` | Mod assets, store directories, layout patch, legacy migration, `herdr-app check` | Starting anything |
| `host/app.ts` | One question: is an app window reachable | Starting a window |
| `host/cli.ts` | `pi-schedulers` command surface | Timers, dispatch |
| `extension.ts` | `/schedulers` in Pi, run requests and scheduler tool registration | Timers, dispatch |
| `create-tool.ts` / `create-confirmation.ts` | SchedulerCreate schema, mode checks, resolved human preview and confirmed definition authoring | Dispatch, worktree creation, install, trust/auth writes |
| `herdr/pi-schedulers/main.js` | The bar's clock and dispatch, the dashboard and editor as authors | A second clock, a second validator |

Because `herdr-app check` runs with a narrower grant than the app, it proves the
mod loads and renders but not that it can read the store; that read is exercised
by the running app. `docs/REFERENCE.md` and the verification log record the
difference so it is not mistaken for a capability failure.

`herdr/pi-schedulers/core/*.js` is a byte-identical copy of `dist/core/*.js`,
written by `npm run build`, because Herdr loads a mod through relative paths
from its own folder.
