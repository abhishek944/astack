# pi-schedulers pane

Two roles from one mod, picked by `props().slot`:

- `bar` — the block in Herdr's top row, beside Files and Changes. It is the only
  owner of the scheduler clock and dispatch. Its button uses native
  `layout.select/show/hide` on the existing right-panel stack and registers
  `schedulers` in `workspace.panels` for native per-space restoration.
- `panel` — the `schedulers` child of native `panel-body`, listing tasks with
  Run now, Edit, Pause/Resume, Delete and Open run. New/Edit shows the editor
  inside the same panel, validated by the package's core. Cancel returns to
  the list without saving. Mutations share the dispatcher's task lock.

The panel header keeps Schedulers on the left and named New task/Open space
icon buttons on the right. The editor is one scrolling five-point planning
rail: description, environment, rhythm, runner, then standalone Enabled.
Workspace, Model and Thinking use native keyboard-operable dropdowns. Model
search filters real offline configured Pi chat metadata through the package's
Node host (`host.json`, written by the installer); it cannot save search text.
Pi default is intentional, unavailable stored selections remain unchanged, and
loading/error/Retry/no-match states do not reset other fields. Runs use fresh
independent sessions with normal configured tools/extensions/MCP, not legacy
task.tools restrictions. Supported First Mate worker suppression and existing
project trust are inspected for the actual run folder; missing trust is an
explicit pre-launch error, never an automatic grant or silent resource stripping. The top Schedulers
toggle hides the panel; there is no Close button or bottom lifecycle segment.

No main dashboard or editor overlay is created. A restored overlay from an
older build closes itself. Files/Changes controls, panel sizing and per-space
selection remain owned by Herdr. Hiding the panel or switching its content
never removes the persistent bar or starts another dispatcher.

`/schedulers install` (or `pi-schedulers install`) copies this folder into
`<Herdr app home>/mods/pi-schedulers`, creates the store, and adds the `bar`
block beside the app's tab bar and the `panel` block inside the existing
Files/Changes stack. An older bar-only install is upgraded. Layouts without
that native stack are reported as unsupported. It keeps a backup of the
layout and refuses to edit Herdr's shipped layouts.

The scheduler runs while the Herdr app runs. On macOS the red close button hides
the app instead of destroying the window, and the host exposes no visibility
signal to mods, so closing the window does not stop scheduling; quitting does.

Checks:

```sh
herdr-app check ~/.config/herdr-app/mods/pi-schedulers
herdr-app status
```

There is nothing to start: the clock appears with the bar and dies with the app.

Each task uses an exclusive-file transaction lock shared with CLI/extension
mutations. The dispatcher holds it from current-state validation through launch
acceptance and result save. Busy actions are refused, not queued or lost.
Locks never expire or get stolen; automatic interrupted-owner recovery is not
supported. Inspect persistent locks or unfinished runs only after every owner
has stopped and launch acceptance has been checked (package usage guide).
