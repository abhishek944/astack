# pi-schedulers usage guide

## First run

1. Install the app side once: `pi-schedulers install` (or `/schedulers install`
   in Pi). It copies the mod, creates the store, and puts the Schedulers block
   in the top row beside Files and Changes.
2. Click **Schedulers**. It replaces Files or Changes in the same right-side
   panel. Click **New task** to edit inside that panel; no floating dashboard opens.
3. Fill in the form:
   - **Name** — what shows in the list and on the run tab.
   - **Prompt** — the message the new Pi session starts with.
   - **Folder** — where the session runs. `Choose…` opens the system picker.
   - **Workspace** — *Project folder* runs in that folder; *Existing worktree*
     runs in a path you give; *New worktree* runs `git worktree add` from the
     base branch on every dispatch and never deletes it afterwards.
   - **When** — *At a time* with `HH:MM` and weekday buttons (none selected
     means every day), or *Every interval* in minutes.
   - **Model** — a searchable dropdown of real locally configured Pi chat models.
     Search provider, ID or display name. **Pi default** intentionally leaves the
     optional selection empty. Existing unavailable values remain unchanged until
     you choose another model. Scoped/All uses Pi's actual configured model scope.
   - **Thinking** — a dropdown of Pi thinking levels, or **Default**.
   - **Enabled** — pause without deleting.
4. **Save** returns to the list. The row shows the schedule and the next run.
   **Cancel** returns without saving. Clicking **Files** or **Changes** replaces
   the panel content; returning to Schedulers keeps an unfinished draft. Click
   Schedulers again to hide the panel. Panel width and
   each space's selected panel continue to use Herdr's native behavior. Switching
   or closing the panel does not stop scheduling.

## Running

- Scheduled runs start on their own while Herdr is running. Each one opens a
  tab in the **Schedulers** space, named after the task and the time, without
  moving your current view. The first run creates that space (with one shell
  tab) before it launches, and it is only recorded as started once the launch
  itself has been accepted.
- **Run now** asks for an immediate dispatch. It is recorded as a request and
  the scheduler picks it up on its next tick; if the app is not running nothing
  is queued. A busy task, an unfinished dispatch, or an already-pending request
  is refused explicitly; no additional request is accepted and then discarded.
- **Open run** switches to that run's tab. If the tab is gone it reopens the
  same Pi session with `pi --session <id>` in the folder it ran in.
- **Pause** stops future dispatches; a run already accepted keeps going.
- **Delete** asks once, then removes the task. Its session files stay on disk.
- **Edit/Pause/Delete/Run now** during that task's dispatch or another mutation
  return a busy error without changing anything. Retry after dispatch completes.

A tab stays open after the agent finishes, so you can read the transcript or
continue the conversation. Closing the tab does not delete the session.

## What a run may do

Scheduled runs require **Pi 1.4.0 or newer** for supported runtime-policy
inspection. Each run starts a fresh persistent session and uses the supported
`--firstmate-worker` marker when First Mate registers it, so coordinator
guidance does not constrain the scheduled task.

Runs use Pi's normal configured tools, extensions and MCP. There is no
scheduler-imposed built-in tool allowlist or forced `--no-mcp`. Legacy stored
`tools` values, including older `--tools` edits, remain compatible metadata
but no longer restrict execution.

The scheduler respects existing project trust, without `--approve` or
`--no-approve`. Already-trusted project resources load normally. Protected
resources without a saved/parent affirmative grant or the user's existing
always-trust default produce an explicit failure before Pi launch. Establish
the intended trust decision in Pi in the actual run folder and retry; the
scheduler does not grant it, silently drop project resources or open an
unattended trust prompt. Pi authentication and custom extension policy are not
bypassed.

Point four states this normal-toolset/independent-session policy. Enabled
remains the final standalone fifth point.

## Day-to-day commands

```sh
pi-schedulers list                 # schedule, next run, last status
pi-schedulers state                # store path, due count, is Herdr reachable
pi-schedulers run "Nightly deps"
pi-schedulers pause "Nightly deps" # enable / resume also exist
pi-schedulers rm "Nightly deps"
```

In Pi: `/schedulers`, `/schedulers show <name>`, `/schedulers run <name>`,
`/schedulers pause|resume|rm <name>`, `/schedulers install`.

## Quitting, closing and hiding

The scheduler lives in the app, so:

- **Quit** (`Cmd+Q`) — the scheduler stops. Nothing runs while it is gone.
- **Close the window** (macOS red button) — Herdr *hides* the app rather than
  destroying the window, and it exposes no visibility signal to mods, so
  scheduling continues. Close is not a stop condition on this version.
- **Hide** (`Cmd+H`) — same as close: the app is still running.
- **Sleep or power off** — nothing ticks; on wake the next due run follows the
  usual rules (a fixed run more than ten minutes late is skipped, an overdue
  interval gets one catch-up).

## When something looks wrong

- **No block in the top row** — run the installer and read its output; it says
  whether the layout was patched or kept.
- **"The scheduler store is missing"** in the bar — the mod is installed but
  `data/pi-schedulers/tasks/` is gone. Re-run the installer.
- **"Unreadable files"** in the dashboard — one task file is malformed; the
  message names it and the other tasks keep running.
- **A run failed before it started** — the row keeps the message: `git` missing
  or a bad base branch for a new worktree, `hc` refusing the adoption, an old
  `pi` version, or a folder that no longer exists.
- **"That task changed or was deleted"** — another writer saved the same task
  first; rerun the command, or reopen the editor. Stale edits do not resurrect it.
- **"Task is busy or has an interrupted owner"** — another transaction holds
  its lock. It never expires. If the owner was interrupted, follow the offline
  inspection below; elapsed age does not prove that an owner stopped.
- **Nothing fires** — check that Herdr is running, that the task is enabled, and
  that `pi-schedulers state` shows a next run.
- **Two windows** — the shared task lock serializes the full current-state
  decision through launch acceptance. Neither can steal a live owner's lock.

### Interrupted owner: manual inspection, not automatic recovery

There is no supported cross-mod owner-death signal. A crash/reload in a task
transaction can leave `locks/<id>.json` or a `running` state. Sleep or an old
lock timestamp is not evidence that dispatch stopped. The dashboard/CLI lists
these records; no automatic retry/replay is attempted.

For repair, first stop **all** scheduler owners (quit every Herdr instance using
that app home and finish any CLI mutation). Back up that task's definition,
state and lock. Inspect `lastRunId` / `lastSessionId`, Core terminals and the
Schedulers tabs to determine whether launch was accepted. If uncertain, do not
replay it. While offline, leave the definition paused (`enabled: false`), mark
an unfinished state `failed` with an inspection note and clear `runRequestedAt`
and `nextRunAt`. Remove its lock only after the old owners are known stopped.
Reopen Herdr, inspect the row, and explicitly enable/request a new run when
appropriate. This manual path is not a multi-owner automatic-recovery guarantee.
