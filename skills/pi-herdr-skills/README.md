# pi-herdr-skills

A portable collection of global [Pi](https://pi.dev/) skills for planning, implementation, browser and desktop work, UI/UX auditing, communication, and [Herdr](https://herdr.dev/)-hosted Pi agents. Diagram, review and model-routing skills now ship from Astack packages; see [package-owned skills](#package-owned-skills).

> [!WARNING]
> Pi extensions run with your user permissions, and skills can instruct an agent to run commands. Review this repository and every extension you install before enabling it.

## Install the skills

First [install Pi](https://pi.dev/docs/latest/quickstart):

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Clone this repository, inspect it, and run the conflict-safe installer:

```bash
git clone https://github.com/abhishek944/pi-herdr-skills.git
cd pi-herdr-skills
./scripts/install.sh --dry-run
./scripts/install.sh
```

The installer copies this repository's skills into the shared global `~/.agents/skills/` directory (discovered by Pi, Codex, and OpenCode). It does not require or install a permission extension or policy. It refuses to overwrite a different managed skill. If you intentionally replace conflicts, `./scripts/install.sh --force` backs up the existing files under `~/.pi/agent/skills-backups/` first.

Use `./scripts/install.sh --skip-conflicts` when some managed skills are locally modified but you still want missing/non-conflicting managed skills installed. It leaves every conflicting directory untouched, installs only missing or already-compatible skills, and reports the preserved conflicts. The default still refuses to overwrite conflicts; `--force` remains the only replacement route, and `--force`/`--skip-conflicts` are mutually exclusive.

Restart Pi, or run `/reload` in an existing Pi session. See the official [skills documentation](https://pi.dev/docs/latest/skills) for Pi's discovery rules.

### Update or remove

Update the checkout, inspect the diff, and reinstall:

```bash
cd pi-herdr-skills
git pull --ff-only
npm run check
./scripts/install.sh --dry-run
./scripts/install.sh --force
```

If you are updating from a version that included the retired `herdr-orchestrator` skill, the installer cannot discover that removed source directory. Inspect and back up any local changes, then remove its installed copy and reload Pi:

```bash
rm -rf -- "$HOME/.agents/skills/herdr-orchestrator"
```

If upgrading from `discuss` or `plainspoken-responses`, the installer does not remove their retired global directories. After inspecting and backing up any local changes, remove `~/.agents/skills/discuss/` and `~/.agents/skills/plainspoken-responses/` so Pi loads only `research` and `talk-human`. Reload Pi afterward.

The same applies to the retired `caveman` and `next-feature` skills. The installer cannot discover those removed source directories, so inspect and back up any local changes, then remove `~/.agents/skills/caveman/` and `~/.agents/skills/next-feature/`.

`--force` creates a backup before replacing any locally changed skill. `--skip-conflicts` never overwrites a conflict; it reports the preserved names and installs the rest. To uninstall matching copies:

```bash
./scripts/install.sh --uninstall --dry-run
./scripts/install.sh --uninstall
```

If an installed skill was modified, uninstall refuses to remove it unless you add `--force`; forced removal backs it up first.

## Included skills

| Skill | Purpose |
| --- | --- |
| `browser-use` | Automates browser navigation, forms, screenshots, testing, and extraction. |
| `commit-and-merge` | Commits real changes and merges into the default branch when explicitly requested. |
| `computer-use` | Operates desktop apps through local Cua Driver MCP with grounded input, screenshot forwarding, and verified outcomes. |
| `implement` | Coordinates every tracked Work with session/Work/Task artifact paths, self-versus-delegate decisions, checks, and proportionate review while preserving specialized scope. |
| `retro` | Reviews a coding session for ways to improve the agent's working environment; invoke explicitly with `/skill:retro`. |
| `talk-human` | Writes clear, friendly, concise replies with plain language and exact technical detail. |

These six skills are the complete set this installer owns. Some of them depend on other installed skills by name. Install the complete set rather than copying only `implement`.

### Package-owned skills

The diagram, review and policy skills moved out of this repository into skill-only Astack packages. Names, helpers and licenses are preserved; `ui-ux-testing` now has a read-only audit contract. They are not part of this installer or its checksum manifest. Install each package and reload Pi:

```bash
pi install /path/to/astack/packages/pi-visuals
pi install /path/to/astack/packages/pi-review
pi install /path/to/astack/packages/pi-research
pi install /path/to/astack/packages/pi-grill-me
pi install /path/to/astack/packages/pi-firstmate
pi install git:github.com/abhishek944/pi-herdr
```

| Package | Skills | Notes |
| --- | --- | --- |
| `pi-visuals` | `archify`, `visual-explainer` | Bundles the complete pinned Archify runtime, assets and notices. `visual-explainer` routes standalone technical diagrams to `archify`. |
| `pi-review` | `agent-review`, `awesome-logging-standards`, `codebase-design`, `no-arbitrary-limits`, `no-unit-tests`, `security-audit`, `ui-ux-testing` | `codebase-design` is the design reference for `design-council`, `implement` and `agent-review`. `security-audit` keeps Cloudflare's MIT-licensed guidance, schema, validators, license and pinned provenance. `no-unit-tests` and `no-arbitrary-limits` stay general task policies, not review-only rules. `ui-ux-testing` is a read-only audit that reports findings and suggested fixes; the caller owns fixes and delegation. |
| `pi-herdr` | `herdr`, `model-routing-policy` | Eight `Agent*` tools plus the editable routing defaults, described under [Herdr Core setup](#herdr-core-setup). |
| `pi-research` | `research`, `read-flows`, `design-council` | Also provides the one-shot `/ask` command and its reusable read-only guard. |
| `pi-grill-me` | `grill-me`, `ui-ux-grill-me` | Browser-based plan and UI/UX interviews with recorded answers. |
| `pi-firstmate` | `firstmate` | Coordinator mode extension and skill, described under [First Mate coordinator mode](#first-mate-coordinator-mode). |

Before migrating, inspect and back up the matching `~/.agents/skills/<name>/` directories, then remove them after verifying the package-owned skills load. The installer cannot remove directories that are no longer in its source tree. Pi keeps the first discovered skill and warns about a duplicate name, so do not keep both copies.

The `ui-ux-testing` skill moved into `pi-review` on 2026-11-04 and is now read-only: it reports verified defects and suggested fixes, while the caller owns scope, fixes and delegation. Remove its old global copy with the other package-owned skills.

`here-now` is retired. Its skill and provenance files were removed from this repository and from active global installs. The independent here.now delivery backend inside `pi-decisions` is a separate component: it keeps its own configuration, credentials and documented behavior.

`codebase-design`, `talk-human`, `implement`, `archify`, `visual-explainer`, `model-routing-policy`, `no-unit-tests` and `no-arbitrary-limits` are referenced by name from several package-owned skills. Keep those packages and this repository installed together so the references resolve.

The `research`, `read-flows`, and `design-council` skills are now provided by [pi-research](../../packages/pi-research), together with the one-shot `/ask` command and its reusable read-only guard, not by this skill installer. Install the package from its Astack directory and reload Pi:

```bash
pi install /path/to/astack/packages/pi-research
```

Before migrating, inspect and back up `~/.agents/skills/research/`, `~/.agents/skills/read-flows/`, and `~/.agents/skills/design-council/`; after verifying the package-owned skills load, remove those old global copies to avoid duplicate skill names. The installer does not automatically remove retired directories. Those skills reference `codebase-design`, `talk-human`, `implement` and `archify` by name, so keep the owning packages and this repository installed.

The `grill-me` and `ui-ux-grill-me` skills are now provided by [pi-grill-me](../../packages/pi-grill-me), not by this skill installer. Install the package from its Astack directory and reload Pi:

```bash
pi install /path/to/astack/packages/pi-grill-me
```

Before migrating, inspect and back up `~/.agents/skills/grill-me/` and `~/.agents/skills/ui-ux-grill-me/`; after verifying the package-owned skills load, remove those old global copies to avoid duplicate skill names. The installer does not automatically remove retired directories. Keep `talk-human` and `implement` from this repository and `model-routing-policy` from pi-herdr installed, because these skills reference them by name.

The `herdr` skill, the editable `model-routing-policy` skill and eight `Agent*` tools are now provided together by [pi-herdr](https://github.com/abhishek944/pi-herdr), not by this skill installer or pi-tasks. Install pi-herdr with the compatible pi-tasks source described in its README and pi-loop-monitor. Published pi-tasks 0.15.0 still registers the old Agent tools, so do not load it alongside pi-herdr. Before migrating, inspect and back up `~/.agents/skills/herdr/` and `~/.agents/skills/model-routing-policy/`; after verifying pi-herdr loads its bundled skills, remove the old global copies to avoid duplicate skill names. The installer does not automatically remove retired directories. Other managed skills remain here.

`implement`, the package-provided `herdr` skill, pi-tasks, pi-herdr, and pi-loop-monitor share a coordination contract: pi-tasks owns records/progress and timing, `implement` owns task ownership decisions and artifact paths, pi-herdr owns Agent tools/lifecycle, and pi-loop-monitor owns monitoring. Root task artifacts use repository-relative `var/<sessionId>/<workId>/<taskId>/`; delegated tasks append their own session/Work/Task IDs below the exact parent task directory. AgentCreate derives and creates the delegated task directory from the host session and real Work/Task IDs: root owners omit `parentTaskDir`, while delegated owners pass the exact value from their assignment. Tool callers do not shell-read the session ID or pre-create that directory; direct Herdr Core CLI launches still prepare paths manually. Require real tracking IDs before execution, and record paths and `self`/`delegate` reasons in `taskInfo`. This is instruction-only, not automatic enforcement or migration. All managed skills and their helpers use this same ownership contract. Specialized permissions, file formats and cleanup rules remain intact; feature names, interview slugs and lane labels are descriptive metadata, not alternative artifact roots. Existing artifacts are not moved implicitly.

Edit `skills/model-routing-policy/SKILL.md` inside the installed pi-herdr package to change subagent model, thinking, and Fast defaults. `implement`, `agent-review`, `herdr`, `firstmate`, and the package-provided `grill-me` and `ui-ux-grill-me` skills read that policy before launching agents. Explicit user choices override its defaults; the parent agent's model is unchanged. Nothing in the pi-herdr extension hard-codes those choices, so an edit takes effect after `/reload` or a restart without rebuilding. Reinstall pi-herdr after editing its source checkout so the installed copy stays current.

### Desktop computer use

`computer-use` uses Pi's native MCP with an independently installed official [Cua Driver](https://cua.ai/docs/cua-driver/quickstart). It does not install a computer-use extension, replace Pi's model, or invoke another agent. On macOS, after reviewing and installing Driver and approving its OS permissions, register the signed app executable globally:

```bash
pi mcp add cua-driver --exposure codemode -- /Applications/CuaDriver.app/Contents/MacOS/cua-driver mcp
pi mcp list
```

On other platforms, use the reviewed `cua-driver` executable's absolute path. The CLI adds one server to personal `mcp.json`; preserve unrelated servers. Run `/reload`, then try `/skill:computer-use Open Calculator, compute 6 × 7, and verify 42 from a fresh window snapshot.`

The local server controls the real host desktop, not a VM. Screenshots and extracted app text can reach Pi's model provider. The skill recommends narrow captures, live-schema discovery, sequential actions, outcome verification, and explicit authorization for consequential steps; it is not an enforced sandbox or permission gate. For unattended work, use an isolated desktop or a reviewed bounded Driver capability manifest.

### Technical diagrams with Archify

The complete [Archify v3.0.1](https://github.com/tt-a1i/archify/releases/tag/v3.0.1) runtime ships in the `pi-visuals` package under its `skills/archify/` directory; no npm install or separate skill-manager install is needed. It requires Node.js >=18 and Chrome/Chromium for its full automated diagram browser gate. See that package's [provenance and update instructions](../../packages/pi-visuals/skills/archify/PROVENANCE.md).

`visual-explainer`, also in `pi-visuals`, routes standalone technical diagrams to Archify while retaining reports, comparisons, dashboards, and small embedded Mermaid diagrams. `research` and `design-council` can optionally hand off grounded findings or explicitly labeled proposals. Interview response collection, task ownership, and review judgment are unchanged.

Ask, for example: “Use Archify to diagram the cache-miss request path in this repository.” Candidates, HTML, receipts and exports stay inside the owning task's canonical session/Work/Task directory. Repository citations are verified against a pinned committed revision, not uncommitted worktree bytes. Automated checks and actual visual inspection are reported separately.

Archify may check its upstream update manifest and cache a reminder; it does not automatically install updates. Review and update the pinned bundle through `pi-visuals` instead. Bundled brand marks retain separate license and trademark terms; see the package's [third-party notices](../../packages/pi-visuals/THIRD_PARTY_NOTICES.md).

### Session coordination

The work-owning skills share one concise coordination rule when the corresponding extensions are loaded:

- **Work** is the overall outcome and is managed with `WorkCreate`, `WorkList`, `WorkUpdate`, and `WorkDelete` from `pi-tasks`.
- **Todo** is a concrete step belonging to a work and is managed with `TodoCreate`, `TodoList`, `TodoUpdate`, and `TodoDelete`.
- **Monitor** runs one long-lived background command through `MonitorCreate`, `MonitorList`, `MonitorUpdate`, and `MonitorStop` from `pi-loop-monitor`.
- **Loop** schedules a future, recurring, event-driven, or idle continuation through `LoopCreate`, `LoopList`, `LoopUpdate`, and `LoopDelete`.

Works and todos stay current as normal work progresses. Monitors are used only for background commands, and loops only when a later or repeated wake is needed. None of these records are changed during `/ask`.

When a skill needs retained notes, screenshots, reports or HTML, it reuses the current owner's canonical task directory from `implement`: `var/<sessionId>/<workId>/<taskId>/` for a root task, or `<exactParentTaskDir>/<childSessionId>/<childWorkId>/<childTaskId>/` for delegated work, recursively. Standalone work establishes real tracking first. Generators receive an explicit `--dir <taskDir>` rather than deriving an output root from feature names or interview slugs. The parent retains aggregate DAGs/contracts and links each worker's original evidence at its actual returned path. Optional subfolders such as `screenshots/`, `questions/` and `diagrams/` stay inside their owner's task directory. Historical feature folders remain untouched; there is no implicit migration. Communication-only skills do not create artifacts merely for uniformity. Tool-managed disposable profiles and package caches are not retained task evidence.

### First Mate coordinator mode

The standalone `pi-firstmate` package now bundles the First Mate extension and `firstmate` skill. They are no longer installed or maintained by this repository. Install the package from its own checkout, then reload Pi:

```bash
pi install /path/to/pi-firstmate
```

Keep `"pi-firstmate": { "enabled": false }` in personal settings for a default-off coordinator, or set it to `true` for default-on. `/firstmate on|off` overrides the current session; `/firstmate status` reports the mode and `/firstmate default` clears the override. Conversation, decisions and quick checks stay local while substantial project execution uses whichever authorized subagent orchestration is available. Pi-herdr supplies Agent tools when installed; it is not a mandatory First Mate dependency. First Mate creates no agents itself and blocks no tools.

Pi-herdr workers are recognized by Core labels. Other launchers should pass `--firstmate-worker` to child Pi processes when sharing a default-on configuration; unknown orchestration workers cannot be identified automatically without a marker. See the pi-firstmate README for the integration contract.

When upgrading from the embedded version, remove its old direct extension-path registration if present. Inspect and back up `~/.agents/skills/firstmate/`, then remove that duplicate only after verifying the package-owned skill loads. The installer does not automatically remove retired skill directories. Keep unrelated global skills and configuration.

## Permission gates

This repository no longer installs or requires tool-permission gates. If you installed the previously required extension, remove it globally and reload or restart every running Pi session, including Herdr agents:

```bash
pi remove npm:@gotgenes/pi-permission-system
```

Old policy files and review logs are not needed by the skills. Removing the extension also removes its destructive-command and sensitive-path protection; it does not change Pi's built-in project trust or unrelated skill safety rules.

### Browser workflow prerequisite

`browser-use` and browser-based visual work require the current Browser Use CLI.

```bash
uv tool install --python 3.12 --upgrade --force browser-use
browser-use --doctor
browser-use skill show
```

Browser actions use Python through standard input with pre-imported helpers. The older command-mode interface (`--session`, `open`, `state`, `click`, `input`, `eval`, and `record start/stop`) is not supported by the bundled skill.

## Herdr Core setup

Delegated workflows use **herdr-core (`hc`)** for interactive Pi processes. **herdr-app** provides optional visible-tab presentation and focus; the old `herdr` TUI CLI and its socket integration are not used.

1. Install the app/Core using the official [app download](https://herdr.dev/download/) and [Core guide](https://herdr.dev/core/). Inspect installer scripts before running them. The app installs Core if needed; do not install the old Homebrew `herdr` formula for these workflows.
2. Open the Herdr app, open a project terminal, and run a current Pi version with native OSC 7501 status support (verified with Pi 1.4.0). No legacy `herdr-agent-state.ts` integration is needed for Core status.
3. Verify with `hc --version`, `hc get "$HC_TERMINAL_ID" --json`, and — only when presentation is requested — `herdr-app --version`. Require a real live Core terminal, not a fabricated variable, and an app mapping only for presented workers. Missing HERDR_ENV is normal in Core and must not block parallel grill-me branches.
4. Install pi-herdr, compatible pi-tasks and pi-loop-monitor together, synchronize the managed skills, then run /reload or restart Pi so tool schemas use terminalId/hcTerminalId rather than legacy pane IDs. The `herdr` skill is bundled with pi-herdr rather than managed by this repository.

AgentCreate starts interactive Pi through hc with explicit model settings, verifies native input readiness, registers continuous monitoring, and sends no assignment. Workers are Core-only by default; `present: true` additionally adopts the worker into one dedicated visible tab named exactly with the parent Task ID and verifies the real app mapping before returning tabId. Confirm MonitorList's Core subscription ready receipt before AgentSend. hc --bg does not itself prove a visible tab exists; the wrapper checks the real app mapping when presentation is requested. Use hc for messages/status/output/cleanup and herdr-app for requested presentation and focus. No hidden-worker substitute when presentation was required, and no TUI fallback.

The app closing leaves Core programs running. Core children normally end with their parent program. Do not stop a user's existing TUI server to migrate: finish or explicitly retire its sessions first, then uninstall the old integration/binary without deleting session history.

## Extensions in the source setup

The following package versions were installed globally when this repository was created. They are documented here for reproducibility, but their source code is **not** copied into this repository.

| Package | Snapshot version | What it adds | Source |
| --- | ---: | --- | --- |
| `pi-web-access` | `0.25.0` | Web search, URL fetching, repositories, PDFs, and video tools | [GitHub](https://github.com/nicobailon/pi-web-access) |
| `@narumitw/pi-usage` | `0.52.3` | Account-usage display | [GitHub](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-usage) |
| `@abhishek944/pi-image-gen` | `0.1.1` | Image generation tools and an image-generation skill | [GitHub](https://github.com/abhishek944/pi-image-gen) |
| `@narumitw/pi-goal` | `0.54.3` | Autonomous single-goal workflow | [GitHub](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal) |
| `@abhishek944/pi-research` | `0.1.0` | One-shot `/ask` with a read-only guard, native Durable export, and the `research`, `read-flows`, and `design-council` skills; replaces `@abhishek944/pi-ask` | [Astack](https://github.com/abhishek944/astack/tree/main/packages/pi-research) |
| Pi native OSC 7501 status | current Pi | Reports Pi lifecycle directly to Core; replaces the old TUI-only managed integration for this setup | [Pi terminal setup](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/terminal-setup.md) |

Install the same package versions:

```bash
pi install npm:pi-web-access@0.25.0
pi install npm:@narumitw/pi-usage@0.52.3
pi install npm:@abhishek944/pi-image-gen@0.1.1
pi install npm:@narumitw/pi-goal@0.54.3
pi install /path/to/astack/packages/pi-research
```

Pinned versions recreate the recorded setup. Remove `@<version>` if you intentionally want the latest release. Manage installed packages with `pi list`, `pi config`, `pi update --extensions`, and `pi remove`; see [Pi packages](https://pi.dev/docs/latest/packages).

Package-provided skills, such as the image-generation skill, remain owned and updated by their packages. They are not duplicated under this repository's `skills/` directory, which avoids name collisions and stale copies.

## Maintenance and safety

- Run `npm run check` before installing, committing, or publishing.
- Keep credentials in environment variables or provider login stores, never in skills or examples.
- Do not commit Pi settings, sessions, Herdr configuration, generated `var/` evidence, package caches, or `node_modules/`.
- Review upstream extension release notes before updating pinned versions.
- Keep skill instructions concise and easy to audit.
- Preserve file modes when copying or packaging skills.
- Third-party names and links are informational; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Repository layout

```text
skills/                 Shared Agent Skills directories (Pi, Codex, OpenCode)
skills-manifest.json    Exact skill file checksums and executable modes
scripts/install.sh      Conflict-safe additive global installer and uninstaller
scripts/check-repo.sh   Repository/global skill equality check
third_party/licenses/   Required upstream license texts
package.json            Repository metadata and check command
```

## License

The repository's original packaging and documentation are available under the [MIT License](LICENSE). Redistributed material keeps its upstream terms and required notices in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`third_party/licenses/`](third_party/licenses/).
