# pi-grill-me

Two skill-only Pi workflows for stress-testing a plan or an interface before implementation:

| Skill | Purpose |
| --- | --- |
| `grill-me` | Runs a browser-based design interview in dependency levels with parallel branch owners, recorded answers, and an automatic handoff to implementation. |
| `ui-ux-grill-me` | Captures the current interface, presents grounded visual variants in a browser, resolves independent UX branches, and produces an implementation-ready visual contract. |

This package contains only skill instructions and their helper scripts, references, and templates. It registers no extension code, custom tools, question server, or delivery backend.

## Install

Requires Pi 1.4.0 or newer and Node.js 22 or newer.

From an Astack checkout:

```sh
pi install ./packages/pi-grill-me
```

Or use the package directory's absolute path:

```sh
pi install /path/to/astack/packages/pi-grill-me
```

Run `/reload` in an open Pi session, or restart Pi, after installing or changing packages. Confirm the package is configured with `pi list`.

The package is not published on npm. Publish manually from this directory when a release is intended.

### Migrating from the shared skills repository

`grill-me` and `ui-ux-grill-me` were previously owned by the `pi-herdr-skills` shared skill repository and its global installer. The package is now their source of truth.

If the old global copies exist, inspect and back up `~/.agents/skills/grill-me/` and `~/.agents/skills/ui-ux-grill-me/`, then remove those two directories after the package is configured. The shared installer does not remove retired directories automatically. Do not keep both the global copies and the package loaded: Pi keeps the first discovered skill and warns about the duplicate name.

Keep the other installed skills current. They provide `talk-human` and `implement` from the shared installer, `model-routing-policy` from `pi-herdr`, `no-arbitrary-limits` and `no-unit-tests` from `pi-review`, and the other workflow material these skills reference by name. The `design-council` and `research` skills come from the `@abhishek944/pi-research` package. Install those packages as well; none of them is owned by the shared installer any more.

## Prerequisites

These skills coordinate with separately installed Pi packages and host capabilities. None of them are bundled here.

| Dependency | Role |
| --- | --- |
| Pi 1.4.0+ (`@earendil-works/pi-coding-agent`) | Host. Declared as an optional peer dependency, not bundled. |
| `pi-decisions` | Owns `SubmitQuestion` and `WaitForAnswer`, browser delivery, response archives, and question state. |
| `pi-loop-monitor` | Owns background watchers and wake delivery used by `WaitForAnswer`. |
| `pi-herdr` and a compatible `pi-tasks` | Own Agent tools, Core worker lifecycle, task/timing records, and visible task tabs. |
| Herdr Core (`hc`) and the Herdr app (`herdr-app`) | Provide the Core session and the visible app space used by parallel branch owners. |
| A usable browser | Presents local or hosted interview pages and lets the user choose options. |
| `browser-use` CLI | Required by `ui-ux-grill-me/scripts/capture-viewport.mjs` to capture comparable viewport screenshots. |
| Installed `talk-human` and `implement` skills, `model-routing-policy` from `pi-herdr`, and the `pi-review` policies | Provide response style, implementation coordination, model routing, and task-scope rules referenced by name. |
| `@abhishek944/pi-research` | Provides the `design-council` and `research` skills used for debate and grounding handoffs. |

The local `pi-decisions` package is not published on npm; install it from its Astack package directory. `pi-herdr` also requires a compatible local `pi-tasks` source rather than the published version that still registers the legacy Agent tools. Follow those packages' own compatibility instructions.

## Ownership

- **pi-grill-me:** Skill instructions, decision-tree and visual-contract references, and the helper scripts and templates under `skills/`.
- **pi-decisions:** Question delivery, response archive, and pending-question state.
- **pi-loop-monitor:** Continuous watchers and wake delivery.
- **pi-herdr / pi-tasks:** Agent tools, Core worker lifecycle, visible tabs, and Work/Todo records.
- **Herdr Core / Herdr app:** Terminal processes and their visible app tabs.
- **Shared skills:** `talk-human` and `implement` remain shared-installer skills. `model-routing-policy` is owned by the `@abhishek944/pi-herdr` package, `no-arbitrary-limits` and `no-unit-tests` by `@abhishek944/pi-review`, and `design-council` and `research` by `@abhishek944/pi-research`.

The skills use the global `implement` artifact contract for evidence. They write only inside the canonical session/Work/Task directory and do not use feature-named output roots.

## Development

Run the package check from this directory:

```sh
npm run check
```

That runs `npm pack --dry-run`, which validates the package identity and the shipped file inventory without publishing. Use `npm pack --dry-run --json` for an exact file list. The skill helpers use only Node built-ins and sibling scripts; there are no package runtime dependencies.

Live browser interviews, Herdr worker launches, and host loading are user-owned verification steps. No unit tests are included or run.

## License

[MIT](LICENSE)
