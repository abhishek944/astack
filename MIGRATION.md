# Migration record

Astack was created on 2026-11-03 by importing every maintained first-party repository from `/Users/abhishektatikella/Documents/pi-extensions`. Original repositories were left untouched; each unit below retains its own history, tags, manifests, licenses, and third-party notices.

## Imported units

| Source repository | Prefix | Source HEAD | Commits | Release tags | Import commit |
|---|---|---|---|---|---|
| `abhishek944/pi-ask` | `packages/pi-ask` | `8526c84a0ee7a45663069c0ad41f7076ba461d66` | 10 | 6 | `3c8527a2dab3` |
| `abhishek944/pi-classifier` | `packages/pi-classifier` | `9242276690fcfa356c188aaaae58ed244c43ee10` | 7 | 5 | `84df5a796b2a` |
| `abhishek944/pi-decisions` | `packages/pi-decisions` | `b6ad702aa063a538936c3424efd46f1d1b39a536` | 1 | 0 | `6cb44ad4436f` |
| `abhishek944/pi-firstmate` | `packages/pi-firstmate` | `4645a868e2c9db9fb7b2fd5dac4ecfe28e8e6443` | 2 | 0 | `eaf7ba8f88fd` |
| `abhishek944/pi-herdr` | `packages/pi-herdr` | `52ac1c74f5165211f03b8f7e54fd3f4f8038566a` | 1 | 0 | `0c2ae4f0dd16` |
| `abhishek944/pi-image-gen` | `packages/pi-image-gen` | `5c4ede42e25d8e4e269370149b06fd661db5f60c` | 18 | 13 | `c17e67fdad0b` |
| `abhishek944/pi-loop-monitor` | `packages/pi-loop-monitor` | `9d8a4561c85ab3b085301bca4b33d1c70fad7b57` | 17 | 12 | `a28b6a3b146d` |
| `abhishek944/pi-tasks` | `packages/pi-tasks` | `6686f2a75b0364fc5104c2693079f07d2a69945f` | 30 | 21 | `40550a02ee20` |
| `abhishek944/pi-herdr-skills` | `skills/pi-herdr-skills` | `dada6f0d762a7bf9e4245ffaa033941427243417` | 18 | 8 | `a8d1d9b66731` |
| `abhishek944/pi-slack` | `services/pi-slack` | `3d276193498dd0821990c43d76b2182df15d3b63` | 1 | 0 | `5e16ec9b5540` |

## Method

For each source, the committed history was imported with:

```bash
git remote add src-<repo> <local checkout>
git fetch --no-tags src-<repo> refs/heads/main:refs/remotes/src-<repo>/main
git fetch --no-tags src-<repo> 'refs/tags/*:refs/tags/<repo>/*'
git merge --allow-unrelated-histories --no-commit -s ours refs/remotes/src-<repo>/main
git read-tree --prefix=<prefix>/ -u refs/remotes/src-<repo>/main
git commit -m "chore: import <repo> history from abhishek944/<repo>@<sha>"
```

Original commits, authors, dates, and tag objects remain reachable. Release tags are namespaced per source (`pi-ask/v0.4.4`) to avoid collisions. The remotes `src-<repo>` now point at the corresponding GitHub URLs so history can be fetched again; no remote was pushed.

## Working tree

After the history import, each source working tree was copied over its prefix, excluding `.git`, `node_modules`, `var`, `.pi`, `.verify`, `generated-sprites`, `tsconfig.tsbuildinfo`, `*.tgz`, OS files, Slack plist backups, generated Herdr type files, and gitignored `dist` output. This preserved tracked `dist` for `pi-firstmate`, `pi-herdr`, `pi-decisions`, and `pi-tasks`.

Uncommitted source changes were kept as **uncommitted changes** in Astack, not migration commits:

| Source | Status entries preserved |
|---|---|
| `pi-firstmate` | 10 |
| `pi-herdr` | 7 |
| `pi-herdr-skills` | 17 |
| `pi-tasks` | 5 |

Run `git status` to review them.

## Excluded repositories

- `pi-web-access` — verified fork of `nicobailon/pi-web-access`; third-party, not imported.
- `pi-sandbox` — first-party repository, retired during this migration under explicit user authorization. A full Git bundle and worktree archive were recorded before deletion; see the migration summary artifacts.
