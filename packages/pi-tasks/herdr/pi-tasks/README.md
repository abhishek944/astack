# Native Herdr Tasks pane

A read-only native GPUI view of the same per-Pi-session JSON used by pi-tasks. No browser, second Pi process, task database, model call, HTTP server or task editing.

## Install and open

From an updated local Pi terminal already displayed in Herdr, run `/works herdr-on`. The command validates the session file and source terminal, installs missing content assets into `<Herdr app home>/mods/pi-tasks/`, and opens beside that exact terminal, or stacks below its same-session Loops/Monitors pane if already open. Reopening focuses the existing Tasks pane. The opener uses the normal desktop app home (`~/.config/herdr-app`, or the `XDG_CONFIG_HOME` equivalent), ignoring inherited `HERDR_APP_HOME` fixture overrides for both app commands and asset installation. Existing/customized mod files are never overwritten by the command; upgrade those assets explicitly after keeping a backup.

The always-visible × belongs to Herdr's real pane header, not the content view. On first setup the command uses Herdr's official clone operations to create:

- a personal `mods/pi-tasks-pane-header/`, copying the current header and assets; its original renderer is kept as `base.js`;
- a personal `layouts/pi-tasks-<current-layout>.json`, selected for this window, with the Tasks-aware header.

Original layout/header files remain untouched. Non-Tasks headers use the copied original renderer and behavior. A header shorter than 32px is raised to 32px in the personal layout for the close target. Switch back to the original layout to undo the layout selection. The current layout must already have an always-visible top pane-header mod; absent/bottom/hover-only or mixed headers report a bounded setup error instead of changing unrelated structures. Existing conflicting personal assets are preserved, not replaced. A compatible existing personal Tasks layout may be reused.

After changing the installed extension, run `/reload`, or restart Pi and resume the same session if an old loaded module has no snapshot binding. `/works compact-off` hides only the compact Pi TUI; tracking and the native view continue. Reopening focuses the existing same-session view, never another writer. `/works herdr-off` closes only matching Tasks mod panes in this terminal’s tab; tracking and the compact display continue.

Developer checks:

```sh
herdr-app check ~/.config/herdr-app/mods/pi-tasks
herdr-app check ~/.config/herdr-app/mods/pi-tasks-pane-header
```

`header.js` in this bundle is an installation template. Its `./base.js` is supplied by cloning the actual configured header, not bundled as an unrelated copy of Herdr's code. Never edit Herdr's shipped `pane` mod in place.

## Behavior

- Compact real Work → Task rows, newest Work first with older Works below; task order within each Work stays unchanged. No invented subtasks. Activate a Work name to fold its tasks, or a task name to toggle an unboxed inline description/relevant blocked reason. The selected task is highlighted across its whole row; title focus uses an underline rather than a separate text-colored fill. Double-clicking counts as one activation instead of immediately toggling the description twice. Owner/link marker lines stay in stored data but are not visible metadata.
- Leading loader only while the task is genuinely running, `!` for blocked, `✓` for complete, quiet idle/cancelled marks. No session/connection bar, top counts, extra owner/status fact line or Read-only footer.
- Plain right-aligned progress and measured effort. Work completion averages noncancelled tasks; unknown propagates. Effort includes cancelled time and imported cumulative reports once. Unknown is `—`, known zero `0s`.
- A measured clock ticks only for a live source actually working on the selected measured task. Saved/offline/paused values freeze; time is not wall-clock age or ETA. Native spinner animation is independent of clock redraws. This Herdr API does not expose an OS reduced-motion preference.
- `Agent ↗` appears next to a task with a valid existing live delegate link. Activation rechecks that exact link and focuses it; it cannot launch an agent or fall back to a different terminal. Work rows have no Agent button. Agent and task-description controls are independent.
- No three-dot trigger or native action menu is shown. Copy and repository actions remain available through the `/works` dashboard and commands; reopen the native pane to refresh after a watcher error.
- The native header × targets only the exact verified terminal-null pi-tasks pane. Closing leaves Pi, agents and tracking intact. It remains present for populated, empty, loading and error content.
- Snapshot version/session identity and record structure are validated; the directory is watched for atomic replacement. Invalid/missing files show an error, not stale rows. No authoritative record cache or mod-local task persistence is added.

Manual content props are `{sessionId, snapshot, terminal?, openCommand?}`. Bind the full Pi session ID and absolute task JSON path explicitly, never whichever terminal is focused. The source terminal's availability alone does not prove it still hosts that session. Only local file-backed sessions are supported.

`herdr-app check` proves loading and an initial render only. Populated native visual/interaction checks must separately verify file updates, inline details, keyboard focus, linked Agent navigation and guarded close behavior. Browser mockups do not prove native behavior.
