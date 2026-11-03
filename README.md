# Astack

Single monorepo for first-party Pi packages, shared skills, and services.

Each directory under `packages/`, `skills/`, and `services/` is an independent unit with its own manifest, dependency tree, build, and release lifecycle. The root is a private container: it holds documentation and a thin verification script, and has no runtime dependencies, no npm workspaces, and no shared lockfile.

## Layout

| Directory | Package / identity | npm status (2026-11-03) |
|---|---|---|
| `packages/pi-ask` | `@abhishek944/pi-ask` | publishable; published on npm |
| `packages/pi-classifier` | `@abhishek944/pi-classifier` | publishable; published on npm |
| `packages/pi-decisions` | `@abhishek944/pi-decisions` | publishable; not published on npm |
| `packages/pi-firstmate` | `@abhishek944/pi-firstmate` | publishable; not published on npm |
| `packages/pi-herdr` | `@abhishek944/pi-herdr` | publishable; not published on npm |
| `packages/pi-image-gen` | `@abhishek944/pi-image-gen` | publishable; published on npm |
| `packages/pi-loop-monitor` | `@abhishek944/pi-loop-monitor` | publishable; published on npm |
| `packages/pi-tasks` | `@abhishek944/pi-tasks` | publishable; published on npm |
| `skills/pi-herdr-skills` | `pi-herdr-skills` (private) | not published; shared skill source + checksum manifest |
| `services/pi-slack` | `pi-slack` (private) | not published; separately configured Slack service |

“Publishable” means the manifest, `exports`, `files`, and pack output are intact; it is not a claim that the current local version has been released. Registry status was checked on 2026-11-03.

`pi-web-access` is a third-party fork and is intentionally not part of Astack. `pi-sandbox` was retired during the migration; see [MIGRATION.md](MIGRATION.md).

## Requirements

- Node 22 or newer, npm 10 or newer.
- Pi 1.4.0 or newer for loading any package.

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
npm run check:skills    # run skills/pi-herdr-skills/scripts/check-repo.sh
node scripts/check.mjs --all   # npm run check plus the skills check
```

- `npm run check` never installs or edits package metadata. It requires each directory's `node_modules` to exist and fails with the underlying tool error when dependencies are missing.
- `npm run verify` runs `npm ci` in directories that have a lockfile and `npm install --no-package-lock` in `pi-firstmate` (the only unit without one), then runs the same checks.
- `npm run check:skills` compares `skills/*` with `~/.agents/skills/*`; it requires those global installs and does not touch package builds.
- None of these commands creates or runs unit tests.

## Install and cutover

Current Pi installations keep working because the original repositories remain in place. Distribution paths are unchanged:

- Published on npm: `pi install npm:@abhishek944/pi-ask`, `pi-classifier`, `pi-image-gen`, `pi-loop-monitor`, `pi-tasks`. The registry version may be older than the local `package.json`; publishing is manual and was not performed during migration.
- Not published on npm: `pi-decisions`, `pi-firstmate`, and `pi-herdr` install from a local checkout, for example `pi install ./astack/packages/<package>` or the original checkout path.
- Git sources target a repository URL as a whole; Pi has no subdirectory syntax for `pi install git:`. Do not point a git install at Astack expecting a nested package.

Installed-path cutover is user-owned and was not applied during the migration. To switch local-path installs to Astack, update the corresponding entries in `~/.pi/agent/settings.json`:

```text
../../Documents/pi-extensions/pi-tasks      -> ../../Documents/astack/packages/pi-tasks
../../Documents/pi-extensions/pi-firstmate  -> ../../Documents/astack/packages/pi-firstmate
../../Documents/pi-extensions/pi-decisions  -> ../../Documents/astack/packages/pi-decisions
```

Then run `/reload`. The git-installed `pi-herdr` remains tied to `github.com/abhishek944/pi-herdr` until it is republished through npm or reinstalled.

## Shared skills

`skills/pi-herdr-skills` owns the shared skill sources and `skills-manifest.json`. Its contract is unchanged:

- every `skills/<name>` must match `~/.agents/skills/<name>`;
- skill edits must be synchronized to the global install and their manifest hashes updated in the same change;
- `scripts/check-repo.sh` verifies the global equality from the repository root.

Run `npm run check:skills` after any skill edit.

## Slack service

`services/pi-slack` is a private, separately configured service, not a Pi package. Its configuration and secrets live outside the repository (for example `~/.config/pi-slack/slack.env`); only placeholder examples are tracked. See `services/pi-slack/deploy` for launchd/systemd templates and `services/pi-slack/README.md` for setup.

## History

Each subdirectory was imported from its original repository with full commit history and namespaced release tags (`<repo>/vX.Y.Z`). The source commit for each import is recorded in [MIGRATION.md](MIGRATION.md).

The working tree may contain uncommitted changes that mirror uncommitted work from the source checkouts. Those changes were deliberately left uncommitted during the migration so they stay reviewable and are not attributed to the migration. Run `git status` before editing.
