# Astack releases

Astack publishes each package independently. The root is private and has no npm workspaces or shared lockfile. Release status is read-only; publication is a separate, human-dispatched GitHub Actions run.

## Check release state

From the repository root:

```bash
npm run release:status
npm run release:status -- --format json
npm run release:status -- --package pi-loop-monitor
npm run release:status -- --strict
```

The command reports the local version, npm `latest` and dist-tags, published versions, the GitHub `main` manifest version compared with npm, the expected `<package>/v<version>` tag as information, package-local uncommitted files, and the `npm pack --dry-run --ignore-scripts --json` identity of the current artifacts. It never publishes. Plain drift exits `0`; `--strict` exits nonzero when any package has a blocker or a requested remote check is unavailable. Use `--no-pack` or `--no-remote` to skip those checks.

The local pack check requires npm `>= 11.5.1`. npm 10.9.4, bundled with Node 22.21.1, does not list `ignore-scripts` in its `pack` command parameters and can still run a package's `prepare` script despite the flag; the published npm 11.5.1 tarball does list it. Runtime fixtures exercised 10.9.4 and 11.17.0; the 11.5.1 floor is based on that published-source evidence, not an arbitrary stricter cap. The CLI checks the npm version before any local pack and fails closed with a clear error on older npm. Use `--no-pack` on that runtime, or upgrade npm. The GitHub Actions workflow upgrades npm to 11.5.1 before packing.

Common states:

| State | Meaning |
| --- | --- |
| `in-sync` | The local version is published. |
| `local-ahead` | The local version is not published; check the worktree before releasing. |
| `unpublished` | The package name is not on the registry; a one-time bootstrap is required. |
| `registry-ahead` | A published version is newer than the local version. Investigate before publishing. |
| `dirty-tree` | The package directory has uncommitted tracked or untracked files. |
| `check-failed` | Registry metadata, local Git state, package metadata, or the package dry run could not be verified. |
| `private-skipped` | The unit is private or not in the publish allowlist. |

A package is publishable only when it has no blockers. A published local version is always a blocker: npm name/version pairs are immutable. Tag state is reported as `head`, `behind`, or `missing`, but a tag is informational and never blocks publication; the workflow publishes the exact supplied commit.

### Remote Git comparison

The CLI resolves `refs/heads/main` with `git ls-remote` and reads each package manifest from that exact commit through `raw.githubusercontent.com`. It does not fetch, clone, check out, or mutate any local or remote Git ref. Credentials are not used. `--remote-repo` and `--remote-base-url` override those read locations for local mocks.

The separate `REMOTE/NPM` column reports:

| State | Meaning |
| --- | --- |
| `in-sync` | The `main` version is published and not older than npm. |
| `remote-ahead` | The `main` version is not published and is newer than npm. |
| `npm-ahead` | npm contains a version newer than the `main` manifest. |
| `remote-unpublished` | npm has no package entry for that name. |
| `no-remote-manifest` | The manifest is absent from the resolved `main` commit, either as a local `ENOENT` or an HTTPS raw-content `404`. |
| `unavailable` | Git lookup, HTTPS transport, redirect, incomplete response body, or any other raw-content HTTP status failed. JSON includes `errorKind` and `status` where available; this is not treated as no drift. |
| `check-failed` | The remote manifest could not be parsed, or its name/version could not be verified. |
| `skipped` | The check was disabled with `--no-remote` or the unit was skipped. |

Remote state does not change local `publishable`, but it is reported separately and makes `--strict` fail when it is `unavailable` or `check-failed`.

## Publish with GitHub Actions

The workflow is `.github/workflows/publish.yml`. It has no automatic triggers. Drift detection, tags, branch pushes, agents, and status checks cannot start a publication.

A maintainer starts publication by selecting **Run workflow** and supplying:

| Input | Meaning |
| --- | --- |
| `package` | Exact directory name under `packages/`, such as `pi-loop-monitor`. |
| `version` | Exact version in that directory's `package.json`. |
| `commit` | Full immutable 40-character Git commit SHA to build and publish. |

Dispatching the workflow is the publish authorization. The `npm-publish` environment provides an optional second human gate: configure required reviewers in GitHub repository settings before relying on it. The workflow checks out only that commit, verifies the manifest and registry state, installs and builds dependencies inside that package only, verifies `npm pack --dry-run --ignore-scripts --json` against the fresh build, then runs `npm publish --access public` with OIDC trusted publishing. It uses `contents: read` and `id-token: write`; it does not use `NODE_AUTH_TOKEN`, an OTP, or a long-lived npm token.

The workflow publishes one package per run. A failed or blocked package does not imply anything about other packages. Reruns with the same inputs stop if the version is already published.

## One-time setup required from a human

These steps need a human with npm and GitHub account access. No token, OTP, or secret should be pasted into the repository or an agent.

1. Merge this workflow file to `main` with the filename `publish.yml`. npm requires the workflow to exist before the trusted publisher is registered.
2. In GitHub, create or open the `npm-publish` environment and add required reviewers if a second approval gate is wanted.
3. For each package that already exists on npm, register the trusted publisher on npmjs.com under the package's **Settings → Trusted publishing → Add trusted publisher**:
   - GitHub owner: `abhishek944`
   - Repository: `astack`
   - Workflow filename: `publish.yml`
   - Environment: `npm-publish` if the workflow environment is used
   - Permission: allow publish

   With npm 11.15.0 or newer, the equivalent interactive command is:

   ```bash
   npm trust github @abhishek944/pi-loop-monitor \
     --repo abhishek944/astack \
     --file publish.yml \
     --environment npm-publish \
     --allow-publish
   ```

   Repeat for each published package, substituting its package name. `npm trust list <package>` checks the configuration. npm 2FA, write access to the package, and an existing package are prerequisites for `npm trust`. A newly registered trusted publisher must complete one successful publish soon after registration or npm expires it.
4. Bootstrap packages that have never been published. npm cannot register a trusted publisher for a package that does not exist. Publish the first version manually from that package directory with interactive npm 2FA, or use `npm stage publish` and approve the staged version with 2FA. After the package exists, add its trusted publisher and use the workflow for later versions.
5. After a verified OIDC publish, check the registry entry for `dist.attestations.provenance` and run `npm audit signatures`. This is optional hardening once the trusted publisher is known to work; it is not required before the first test publish.

If a publish fails with `ENEEDAUTH`, check the exact workflow filename, `id-token: write`, GitHub-hosted runner, `repository.url`, and trusted-publisher fields before changing anything else. Do not retry an uncertain publish blindly; re-read the registry state first.

## Repository metadata

Every publishable package declares:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/abhishek944/astack.git",
    "directory": "packages/<name>"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

The exact repository URL and workflow fields matter to npm trusted publishing. Adding a new publishable package requires adding it to the allowlist in `scripts/release-status.mjs`, setting this metadata, bootstrapping it if needed, and registering its trusted publisher.

No application capacity limits are added by this automation. Git's full 40-character SHA and npm's immutable name/version pair are release-identity requirements, not throughput controls.
