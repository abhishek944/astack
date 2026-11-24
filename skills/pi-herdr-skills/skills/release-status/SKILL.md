---
name: release-status
description: "Check Astack npm release drift and explain the explicit trusted-publishing workflow. Use when asked about package release readiness, version drift, or publishing Astack packages."
---

# Astack release status

Use this skill for Astack release questions. The repository is a container of independently versioned packages; never treat it as a workspace or publish several packages as one transaction.

## Read-only check

Run the status CLI from the repository root:

```bash
npm run release:status
npm run release:status -- --format json
npm run release:status -- --package pi-tasks
```

Use `--format json` when you need to reason about exact package state. The tarball dry run requires npm `>= 11.5.1`; the CLI checks before packing and fails closed on older npm such as 10.9.4, which can still run `prepare` despite `--ignore-scripts`. On that runtime use `--no-pack` or upgrade npm. `--no-remote` skips the GitHub `main` comparison, and `--strict` turns blockers or an unavailable requested remote check into a nonzero exit. The command checks the local version, npm dist-tags and versions, the GitHub `main` manifest version against npm, the `<package>/v<version>` tag as information, commit alignment, package-local uncommitted files, and the packed identity. It never publishes. Remote comparison uses `git ls-remote` and raw manifest reads; it does not mutate Git refs.

Explain each package independently. Name blockers such as `version-published`, `registry-ahead`, `dirty-tree`, or `check-failed`. Report the separate `REMOTE/NPM` state, including `unavailable` errors honestly rather than treating them as no drift. A missing or behind tag is informational only; publication is bound to the exact supplied commit. Do not call a package publishable when any blocker is present. A matching version in the registry is immutable and is a stop condition, not a reason to retry.

## Publication boundary

Publication happens only through `.github/workflows/publish.yml` on explicit `workflow_dispatch`. The dispatch inputs are the authorization record: exact `package`, exact `version`, and full immutable 40-character `commit`. The workflow checks out that commit, verifies the package and registry state, installs and builds only that package, verifies the tarball, and publishes with npm trusted publishing OIDC. Drift reports, tags, branch pushes, and agents never start it.

This skill is guidance, not a trust boundary. Do not dispatch the workflow, publish locally, supply an OTP, create a token, change npm account permissions, or ask the user for a secret unless the current request explicitly authorizes that exact action. When publication is explicitly requested, prepare the three input values and direct the human to GitHub; the `npm-publish` environment may require reviewer approval.

For setup details and the exact human-owned npm trust/bootstrap steps, read `docs/RELEASING.md` in the Astack repository. Never put tokens or secrets in the repository, a workflow file, or task notes.
