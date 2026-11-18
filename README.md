# Astack

Single monorepo for first-party Pi packages, shared skills, and services.

Each directory under `packages/`, `skills/`, and `services/` is an independent unit with its own manifest, dependency tree, build, and release lifecycle. The root is a private container: it holds documentation and a thin verification script, and has no runtime dependencies, no npm workspaces, and no shared lockfile.

## Layout

| Directory | Package / identity | npm status (2026-11-03) |
|---|---|---|
| `packages/pi-classifier` | `@abhishek944/pi-classifier` | publishable; published on npm |
| `packages/pi-decisions` | `@abhishek944/pi-decisions` | publishable; not published on npm |
| `packages/pi-firstmate` | `@abhishek944/pi-firstmate` | publishable; not published on npm |
| `packages/pi-grill-me` | `@abhishek944/pi-grill-me` | publishable; not published on npm |
| `packages/pi-herdr` | `@abhishek944/pi-herdr` | publishable; not published on npm |
| `packages/pi-image-gen` | `@abhishek944/pi-image-gen` | publishable; published on npm |
| `packages/pi-loop-monitor` | `@abhishek944/pi-loop-monitor` | publishable; published on npm |
| `packages/pi-research` | `@abhishek944/pi-research` | publishable; replaces `pi-ask`; not published on npm |
| `packages/pi-review` | `@abhishek944/pi-review` | publishable; skill-only; not published on npm |
| `packages/pi-schedulers` | `@abhishek944/pi-schedulers` | publishable; not published on npm |
| `packages/pi-tasks` | `@abhishek944/pi-tasks` | publishable; published on npm |
| `packages/pi-visuals` | `@abhishek944/pi-visuals` | publishable; skill-only; not published on npm |
| `skills/pi-herdr-skills` | `pi-herdr-skills` (private) | not published; shared skill source + checksum manifest |
| `services/pi-litellm` | `pi-litellm` (private) | not published; local Docker LiteLLM gateway + Postgres |
| `services/pi-slack` | `pi-slack` (private) | not published; separately configured Slack service |

“Publishable” means the manifest, `exports`, `files`, and pack output are intact; it is not a claim that the current local version has been released. Registry status was checked on 2026-11-03.

## Capabilities

The tables below list the current source-of-record surface: registered tool names, extension or prompt commands, and bundled skills. They are not a live health check; installed versions, settings, and tool filters can change what a running session exposes.

### Repository packages

| Package | Kind | Runtime tools | Slash commands | Bundled skills | Notes and gates |
|---|---|---|---|---|---|
| `@abhishek944/pi-classifier` | Extension | `classify`, `classify_compare`, `classify_tree`, `classifier_box_image`, `classifier_computer_use` | `/classifier` | — | Provider, fallback, compare, and computer-use routes are configuration-driven; computer use also needs the Cua Driver. |
| `@abhishek944/pi-decisions` | Extension | `SubmitQuestion`, `WaitForAnswer` | — | — | Delivery is `local` by default or `here.now`; a pending `WaitForAnswer` can use a `pi-loop-monitor` watcher. |
| `@abhishek944/pi-firstmate` | Extension + skill | — | `/firstmate` | `firstmate` | `/firstmate on`, `off`, `status`, and `default` control coordinator mode, which can restrict the active tool set. |
| `@abhishek944/pi-grill-me` | Skill-only | — | — | `grill-me`, `ui-ux-grill-me` | No extension code or runtime tools. |
| `@abhishek944/pi-herdr` | Extension + skills | `AgentCreate`, `AgentList`, `AgentStatus`, `AgentOutput`, `AgentSend`, `AgentInterrupt`, `AgentClose`, `AgentFocus` | — | `herdr`, `model-routing-policy` | Requires Herdr Core (`hc`) and the compatible `pi-tasks` delegation bridge. The Herdr app is optional presentation: `AgentCreate` defaults to Core-only and opens or verifies a visible tab only with `present: true`; `AgentFocus` reports `focused: false` when no app is available. |
| `@abhishek944/pi-image-gen` | Extension + skills | `image_generate`, `image_compare`, `sprite_generate`, `image_search`, `image_search_compare` | `/image-gen`, `/image-search` | `image-gen`, `sprite-gen` | `sprite_generate` is active only when `pi-image-gen.spriteGeneration.enabled` is true; it is registered unconditionally and the setting gates active-tool visibility. Image search uses separate `pi-image-search` routes and credentials. |
| `@abhishek944/pi-loop-monitor` | Extension | `LoopCreate`, `LoopList`, `LoopUpdate`, `LoopDelete`, `MonitorCreate`, `MonitorList`, `MonitorUpdate`, `MonitorStop` | `/loop`, `/monitors` | — | — |
| `@abhishek944/pi-research` | Extension + prompt + skills | — | `/ask` | `design-council`, `read-flows`, `research` | `/ask <question>` is a prompt template; the extension adds `/ask on`, `off`, `status`, and `tools` and applies a read-only tool policy. |
| `@abhishek944/pi-review` | Skill-only | — | — | `agent-review`, `awesome-logging-standards`, `codebase-design`, `no-arbitrary-limits`, `no-unit-tests`, `security-audit`, `ui-ux-testing`, `ui-ux-followthrough` | No extension code or runtime tools. `ui-ux-testing` is a read-only audit; the caller owns fixes and delegation. `ui-ux-followthrough` owns post-implementation UI disposition inside an authorized task and adds no permission. |
| `@abhishek944/pi-schedulers` | Extension + Herdr mod | — | `/schedulers` | — | The scheduler clock lives in a Herdr mod's always-shown bar, so runs happen only while the Herdr app is running: no service, login item or supervisor. On macOS the red close button hides the app and Herdr 0.1.12 exposes no visibility signal, so closing the window does not stop scheduling; quitting does. Runs adopt one tab per run in a Schedulers space; unattended runs need Pi 1.0.4+ and use an explicit tool allowlist with `--no-mcp --no-approve`. |
| `@abhishek944/pi-tasks` | Extension | `WorkCreate`, `WorkList`, `WorkUpdate`, `WorkDelete`, `TodoCreate`, `TodoList`, `TodoUpdate`, `TodoDelete`, `TaskTimeExport`, `TaskTimeImport` | `/works` | — | `/works` opens the task dashboard and accepts `delegate T<number>`. |
| `@abhishek944/pi-visuals` | Skill-only | — | — | `archify`, `visual-explainer` | No extension code or runtime tools. |

### External globally configured packages

`pi-web-access` and `@narumitw/pi-usage` are configured globally outside this checkout and are intentionally not Astack units.

| Package | Runtime tools | Slash commands | Bundled skills | Notes and gates |
|---|---|---|---|---|
| `pi-web-access` (third-party fork) | `web_enable` (conditional loader), `web_search`, `source_check`, `fetch_content`, `get_search_content` | `/websearch`, `/curator`, `/google-account`, `/search` | — | Default tool names; availability and names follow its own feature configuration and Pi dynamic-tool support. |
| `@narumitw/pi-usage` | — | `/usage`, `/fast` | — | `/fast` applies only to compatible OpenAI Codex models. |

`pi-sandbox` was retired during the migration; see [MIGRATION.md](MIGRATION.md).

### Standalone global skills

`skills/pi-herdr-skills` owns these eight standalone skills. Each host selects `browser-use` (default), `aside-browser`, both, or neither; none is bundled by a package.

| Skill | Purpose | Invocation |
|---|---|---|
| `aside-browser` | Bundled vendor Aside entry point, selected with `--browser aside` or `--browser both`; it directs the agent to `aside guide` for the live instructions. | `/skill:aside-browser` |
| `browser-use` | Browser testing, screenshots, forms, and extraction with isolated local Chrome. Selected by default, and alongside Aside with `--browser both`. | `/skill:browser-use` |
| `commit-and-merge` | Commit requested repository changes and merge into the default branch using repository conventions. | Manual only: `/skill:commit-and-merge` (`disable-model-invocation: true`). |
| `computer-use` | Operate desktop apps through the local Cua Driver with accessibility elements and verified outcomes. | `/skill:computer-use` |
| `implement` | Coordinate tracked work with artifact paths, ownership decisions, and verification. | `/skill:implement` |
| `retro` | Run a retrospective on a coding session. | Manual only: `/skill:retro` (`disable-model-invocation: true`). |
| `talk-human` | Write clear, beginner-oriented user-facing messages. | `/skill:talk-human` |
| `typescript-best-practices` | Apply type-system rules to TypeScript work: discriminated unions, branded types, boundary validation, exhaustive variants, and schema-derived types. | `/skill:typescript-best-practices` |

All skills, including package-bundled skills, use Pi's generic `/skill:<name>` command when skill commands are enabled. That is separate from extension-registered commands such as `/classifier` and from prompt-template commands such as `/ask`.

`browser-use` is the default browser backend and skill. A host can instead declare `--browser aside` to install the bundled managed `aside-browser` skill and drop the conflicting `browser-use` default, `--browser both` to keep both skills side by side (Aside for already-signed-in sites, `browser-use` for isolated headless testing, with no cookie transfer), or `--browser none` to install no browser skill. `browser-use` remains installed and current on hosts that keep the default. See [SETUP.md](SETUP.md#browser-backend-selection).

## Requirements

- Node 22 or newer, npm 10 or newer.
- Pi 1.4.0 or newer for loading any package.

## Setup

For a fresh Mac or Linux host, the rerunnable installer works before Node exists:

```bash
bash scripts/setup.sh --check   # read-only detection
bash scripts/setup.sh           # install missing runtimes/capabilities, build, register
npm run setup                   # same entry after Node exists
```

It prepares every package independently, registers the 11 local packages, syncs the selected shared skills, and reports each capability as ready/installed/manual/unsupported/failed. The browser backend is an explicit choice: `--browser browser-use` (default), `--browser aside`, `--browser both`, or `--browser none`. Existing tools, auth, package entries, modified skills, sessions, and user services are preserved; by default only `settings.json` packages and an absent `cua-driver` MCP entry can change, with backups. See [SETUP.md](SETUP.md) for options, platform notes, and the Slack delegation boundary.

A headless Ubuntu/Debian host can additionally opt in to a private desktop for the local Cua Driver. It is never installed by default:

```bash
bash scripts/setup.sh --check --desktop   # read-only detection
bash scripts/setup.sh --desktop           # Xvfb + XFCE + session D-Bus + AT-SPI + ffmpeg
scripts/desktop/astack-desktop run -- pi  # start Pi inside that session
```

Only that opt-in writes a systemd user unit (`astack-desktop.service`). No VNC, RDP, public listener, container, or storage service is added, and macOS is unaffected. See the VM smoke test in [SETUP.md](SETUP.md).

## Work on one package

Every package stays independently installable, buildable, and publishable from its own directory. Astack adds no cross-package resolution.

```bash
cd packages/pi-tasks
npm ci                  # pi-firstmate has no lockfile: npm install --no-package-lock
npm run typecheck
npm run build
npm pack --dry-run      # inspect published tarball contents
```

Install, upgrade, and publish behavior is unchanged: `package.json` names, versions, `exports`, `bin`, `files`, `pi`, `dependencies`, and `peerDependencies` are the originals. Publish manually from the package directory; this repository has no automated release pipeline.

## Workspace checks

```bash
npm run check           # package typecheck/build/pack dry-run (where defined) + service typecheck/build
npm run verify          # install each directory first, then run npm run check
npm run check:skills    # verify the skill manifest, then the global skill copies
node scripts/check.mjs --all   # npm run check plus the skills check
```

- `npm run check` never installs or edits package metadata. It requires each directory's `node_modules` to exist and fails with the underlying tool error when dependencies are missing.
- `npm run verify` runs `npm ci` in directories that have a lockfile and `npm install --no-package-lock` in `pi-firstmate` (the only unit without one), then runs the same checks.
- `npm run check:skills` verifies `skills/pi-herdr-skills/skills-manifest.json` against the repository, then compares the selected `skills/*` entries with `~/.agents/skills/*`. It requires those global installs and does not touch package builds. The selection comes from `--browser`, then `$ASTACK_BROWSER`, then `~/.local/share/astack/env.sh`, then `browser-use`. For a scoped global check, run `bash skills/pi-herdr-skills/scripts/check-repo.sh --skill NAME`; `--skill` narrows only the global comparison, still enforces the browser selection, and does not replace the manifest check.
- None of these commands creates or runs unit tests.

## Install and cutover

Current Pi installations keep working because the original repositories remain in place. Distribution paths are unchanged except for the pi-ask consolidation into pi-research:

- Published on npm: `pi install npm:@abhishek944/pi-classifier`, `pi-image-gen`, `pi-loop-monitor`, `pi-tasks`. The registry version may be older than the local `package.json`; publishing is manual and was not performed during migration. The published `@abhishek944/pi-ask` package still installs, but this checkout replaces it with `pi-research`.
- Not published on npm: `pi-decisions`, `pi-firstmate`, `pi-grill-me`, `pi-herdr`, `pi-research`, `pi-review`, `pi-schedulers`, and `pi-visuals` install from a local checkout, for example `pi install ./astack/packages/<package>` or the original checkout path. `pi-grill-me`, `pi-review`, and `pi-visuals` are skill-only packages; they have no extension code or runtime tools. `pi-research` bundles the `/ask` extension, its reusable read-only guard, and the research, read-flows, and design-council skills.
- Git sources target a repository URL as a whole; Pi has no subdirectory syntax for `pi install git:`. Do not point a git install at Astack expecting a nested package.

Installed-path cutover is user-owned and was not applied during the migration. To switch local-path installs to Astack, update the corresponding entries in `~/.pi/agent/settings.json`:

```text
../../Documents/pi-extensions/pi-tasks      -> ../../Documents/astack/packages/pi-tasks
../../Documents/pi-extensions/pi-firstmate  -> ../../Documents/astack/packages/pi-firstmate
../../Documents/pi-extensions/pi-decisions  -> ../../Documents/astack/packages/pi-decisions
```

The pi-ask consolidation also replaced the npm `@abhishek944/pi-ask` entry with `../../Documents/astack/packages/pi-research`.

Then run `/reload`. The git-installed `pi-herdr` remains tied to `github.com/abhishek944/pi-herdr` until it is republished through npm or reinstalled.

## Shared skills

`skills/pi-herdr-skills` owns the shared skill sources and `skills-manifest.json`. Its contract is unchanged:

- every `skills/<name>` must match `~/.agents/skills/<name>`;
- skill edits must be synchronized to the global install and their manifest hashes updated in the same change;
- `scripts/check-manifest.py` verifies the recorded checksums and executable modes, and `scripts/check-repo.sh` verifies the global equality from the repository root; `npm run check:skills` runs both.

The package-owned `grill-me` and `ui-ux-grill-me` skills live in `packages/pi-grill-me` instead. They are not part of the shared installer or its manifest. Install the package, then remove the old global copies of those two skills so Pi does not discover both sources under the same names. Other shared skills remain global and follow the contract above.

The package-owned `research`, `read-flows`, and `design-council` skills live in `packages/pi-research` instead, next to the `/ask` extension and its reusable read-only guard. They are not part of the shared installer or its manifest. Install the package, then remove the old global copies of those three skills so Pi does not discover both sources under the same names.

The package-owned `archify` and `visual-explainer` skills live in `packages/pi-visuals`; `agent-review`, `awesome-logging-standards`, `codebase-design`, `no-arbitrary-limits`, `no-unit-tests`, `security-audit`, `ui-ux-testing`, and `ui-ux-followthrough` live in `packages/pi-review`. Both packages are skill-only and are not part of the shared installer or its manifest. `ui-ux-testing` is a read-only audit: it reports verified findings and suggested fixes, while the caller owns scope, fixes, and delegation. `ui-ux-followthrough` is the separate owner for post-implementation disposition and flag-mode review of a named UI surface: it auto-fixes only clear in-scope defects after an implementation or flags a user-specified UI scope through `ui-ux-grill-me`, a named review without prior implementation starts read-only, and the audit itself never gains repair permission. Install each package, then remove the old global copies of those ten skills so Pi does not discover both sources under the same names.

The package-owned `herdr` and `model-routing-policy` skills ship with `packages/pi-herdr` and its configured git checkout; `model-routing-policy` moved there from the shared installer. The editable provider, model, thinking, and Fast choices remain only in `skills/model-routing-policy/SKILL.md`, never in extension code. Remove the old global `model-routing-policy` copy after the package loads so Pi does not discover both sources under the same name.

The `here-now` skill is retired. Its source, global install, provenance files, and installer entries were removed. The independent here.now delivery backend inside `pi-decisions` is unaffected and keeps its own configuration and credentials.

The remaining shared skills are `browser-use`, `commit-and-merge`, `computer-use`, `implement`, `retro`, and `talk-human`; they stay global and follow the contract above.

Run `npm run check:skills` after any skill edit.

## LiteLLM gateway

`services/pi-litellm` is a private, local-only Docker Compose unit: the LiteLLM gateway with its Admin UI plus a Postgres database, two containers with the proxy published on loopback and no host port for the database. Pi reaches it over the OpenAI-compatible API using a per-person virtual key, not the master key. Generated local credentials live in the gitignored `services/pi-litellm/.env` (mode 0600); only `.env.example` placeholders are tracked. See `services/pi-litellm/README.md` for bootstrap order, key issuance, Pi `models.json` wiring and cost caveats.

## Slack service

`services/pi-slack` is a private, separately configured service, not a Pi package. Its configuration and secrets live outside the repository (for example `~/.config/pi-slack/slack.env`); only placeholder examples are tracked. See `services/pi-slack/deploy` for launchd/systemd templates and `services/pi-slack/README.md` for setup.

## History

Each subdirectory was imported from its original repository with full commit history and namespaced release tags (`<repo>/vX.Y.Z`). The source commit for each import is recorded in [MIGRATION.md](MIGRATION.md).

The working tree may contain uncommitted changes that mirror uncommitted work from the source checkouts. Those changes were deliberately left uncommitted during the migration so they stay reviewable and are not attributed to the migration. Run `git status` before editing.
