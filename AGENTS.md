# Astack conventions

Astack is a container repository. Treat each unit as independent unless a task explicitly changes that.

## Unit boundaries

- `packages/<name>` — one publishable Pi package per directory. Keep its `package.json` identity (`name`, `version`, `exports`, `bin`, `files`, `pi`, dependency fields) and its own lockfile, build output, and scripts. Publish from the package directory.
- `skills/pi-herdr-skills` — shared skill source and checksum manifest. Follow its `AGENTS.md`: edits must be mirrored to `~/.agents/skills/` and reflected in `skills-manifest.json` in the same change, verified with `bash scripts/check-repo.sh`.
- `services/pi-slack` — private service. Never add real tokens, env files, config state, or launchd plists with machine paths. Track only placeholder examples.

## Engineering rules

- Do not introduce npm workspaces, root dependency hoisting, project references, path aliases, or shared build tooling without an explicit requirement. Independent install/build/publish is the contract.
- Do not put host-provided Pi packages (`@earendil-works/pi-*`, `typebox`) into `dependencies`; they belong in `peerDependencies`.
- Do not move a package's files out of its directory to share code between packages. Publish shared code as a package instead.
- Do not edit imported history or rewrite tags. Add new commits.
- Keep `var/`, `node_modules/`, build caches, sessions, and secret files out of Git.

## Verification

Use non-unit lifecycle checks: `npm run typecheck`, `npm run build`, `npm pack --dry-run` (or `npm run check` at the root), plus `npm run check:skills` after skill changes. Do not add unit tests unless the user explicitly asks for them.

## Artifacts

Task artifacts belong under repository-relative `var/<sessionId>/<workId>/<taskId>/` following the global `implement` skill. Do not create feature-named artifact roots.
