# pi-firstmate

A standalone Pi package with an extension and bundled First Mate skill. Turn a primary session into a coordinator: keep conversation, decisions and quick inspection local, and delegate project execution through your installed orchestration backend.

## Install

Requires Pi 1.4.0 or a compatible version with structured prompt sections and `pi.getSettings()`, and Node.js 22.19 or newer.

For a local checkout:

```sh
cd /path/to/pi-firstmate
npm install --ignore-scripts
npm run build
pi install /path/to/pi-firstmate
```

Run Pi from any project directory. Use `/reload` or restart Pi after installation or changes. The explicit package manifest loads `dist/index.js` and `skills/firstmate/SKILL.md`; do not separately copy the skill into a global skills directory or register the source extension again.

First Mate does not install an orchestration backend. Install and authorize pi-herdr or another backend separately if you want delegation. No Herdr, pi-tasks or user-global workflow skill dependency is required to load or enable this package.

## Commands

| Command | Effect |
| --- | --- |
| `/firstmate` or `/firstmate status` | Show effective mode, default, override, worker classification and guidance availability. |
| `/firstmate on` | Enable coordinator guidance for this session. |
| `/firstmate off` | Disable it and supersede earlier coordinator guidance. |
| `/firstmate default` | Clear the session override and follow settings. |

Overrides survive reload and resume of the same session. Navigating branches does not roll them back. Forks have a new session ID and do not inherit the override. Commands never write your settings.

## Default configuration

Merge this section into `~/.pi/agent/settings.json` (or your custom Pi agent directory):

```json
{
  "pi-firstmate": {
    "enabled": false
  }
}
```

The default is off when omitted. Set `enabled` to `true` for default-on primary sessions. A trusted project's `.pi/settings.json` may override it through Pi's normal settings merge. See [config.example.json](config.example.json).

Only a boolean is accepted. Malformed configuration reports a diagnostic and treats the configured default as off; an explicit session override still applies. Other settings keys are untouched.

## Delegation and worker isolation

While on, substantial investigation, project edits, builds, migrations, reviews and permitted checks go to workers. A quick check that grows should become delegated work. Saying "implement this" keeps coordinator mode on; use `/firstmate off` to leave it.

Use the available backend's actual instructions, tools, permissions, monitoring and result lifecycle. With pi-herdr, follow its bundled `herdr` skill and Agent tools. With another installed backend, follow that backend's own instructions. Host/project tracking, artifact and model-routing rules still apply when installed or required; this package adds no mandatory global workflow skills.

If delegation is unavailable or fails, the coordinator should report the concrete blocker and safe options instead of silently executing substantial work itself. First Mate adds no orchestrator, adapter registry, task store, tool gate, model selection or automatic model fallback.

### Other worker launchers

Pass this package's one boolean flag to child Pi processes that load it:

```sh
pi --firstmate-worker
```

The flag defaults to false. When present, it always suppresses coordinator guidance, even with default-on settings or a saved `/firstmate on` override. It also skips optional Core detection, so it works without `hc`. This is a per-process CLI marker, not an inherited global mode environment variable. Ensure your launcher's actual child command passes it; First Mate does not modify launchers. When adding an initial prompt, separate it with `--`, for example `pi --firstmate-worker -- "worker assignment"`. Pi 1.4.0 can otherwise consume a following positional prompt as an extension flag value.

### Optional pi-herdr/Core detection

Without the explicit flag, a process with `HC_TERMINAL_ID` can use `hc get <terminalId> --json` to check the labels written by pi-herdr. Both `pi.task` and `pi.session` identify a worker. `HC_TERMINAL_ID` alone does not: primary Core sessions have it too. Non-Core sessions need neither `hc` nor Herdr installed.

A failed or partial Core lookup suppresses default-on and reports a diagnostic. An explicit `/firstmate on` may enable that unclassified session if you know it is a coordinator; verified workers remain suppressed.

Unknown third-party launcher workers cannot be reliably recognized automatically. Use `--firstmate-worker`, especially when workers share default-on configuration. This package does not claim universal launcher compatibility.

## Boundaries

First Mate is behavioral guidance, not a security sandbox or a guarantee that a model complies. It does not disable tools or grant permissions. Project trust, user authorization, specialized workflows and `/ask` or `/btw` restrictions remain intact. Workers follow their assignment and ordinary instructions, not coordinator delegation guidance.

The extension injects its bundled skill as a structured `first_mate` section before each user or custom-message run, including monitor wakes. Turning it off removes that section and, when earlier guidance was observed, adds a superseding guideline. An unreadable policy reports a diagnostic instead of pretending guidance was installed.

## Development

```sh
npm install --ignore-scripts
npm run lint
npm run typecheck
npm run build
npm pack --dry-run
```

The host Pi package is a peer dependency and a pinned development dependency for current API declarations; it is not bundled as a runtime dependency. `src/index.ts` and generated `dist/index.js` both resolve the same bundled policy relative to their module, independently of the working directory. No unit-test runner is included.

For user-owned live verification, enable the mode in a primary session, request a small project change, inspect actual worker results, then disable it and confirm ordinary execution returns. Check your launcher's child processes with `--firstmate-worker` before enabling a shared default.

## License

[MIT](LICENSE).
