# pi-herdr-skills

A portable collection of global [Pi](https://pi.dev/) skills for planning, implementation, evidence-backed refactoring, browser and desktop work, UI/UX auditing, communication, and [Herdr](https://herdr.dev/)-hosted Pi agents. Diagram, review and model-routing skills now ship from Astack packages; see [package-owned skills](#package-owned-skills).

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

The two broad browser skills are one explicit selection. `./scripts/install.sh` resolves it from `--browser`, then `$ASTACK_BROWSER`, then the recorded `$ASTACK_HOME/env.sh`, then `browser-use`. A fresh no-argument install therefore never adds `aside-browser` beside `browser-use`, and an Aside host's recorded choice is reused. Pass `--browser aside` to select Aside, `--browser both` to keep both skills installed side by side, or `--browser none` for no browser skill:

```bash
./scripts/install.sh --browser aside
./scripts/install.sh --browser browser-use
./scripts/install.sh --browser both
./scripts/install.sh --browser none
```

`--without NAME` remains the generic explicit exclusion for any managed skill: the name is never installed, never reported as a conflict, and never removed implicitly. For example, `--without browser-use` excludes that skill even though it is the default selection.

`scripts/check-repo.sh` verifies the declared selection, so a deliberate omission is still checked instead of silently skipped. It reads `--browser aside|browser-use|both|none`, then `$ASTACK_BROWSER`, then the `ASTACK_BROWSER` line in `$ASTACK_HOME/env.sh`, then the `browser-use` default. With `aside` it verifies the managed `aside-browser` skill and requires `browser-use` to be absent. With `browser-use` it verifies `browser-use` and leaves an installed `aside-browser` untouched. With `both` it verifies both managed skills and requires neither to be absent. With `none` it does not verify browser skills at all.

By default it checks every managed skill and reports every mismatch before exiting 1. Each mismatch lists its differing relative paths with the reason (missing entry, content, executable mode, type or symlink target), using the same tree comparison as the installer. Pass repeatable `--skill NAME` options to check only named skills; the browser selection is still validated, and an `aside` host still requires `browser-use` to be absent even when it is outside the named scope. A named skill must exist in the repository and must be selected by the browser backend when it is a browser skill. Usage errors exit 2, a clean check exits 0, and any mismatch or missing installed skill exits 1. The check requires `python3` for the shared tree comparison. This script checks installed/global equality only; `npm run check` runs the manifest verification first.

```bash
# Fast check of the skills changed in this task.
./scripts/check-repo.sh --skill implement --skill talk-human

# The browser selection still has to agree with the named scope.
./scripts/check-repo.sh --browser aside --skill aside-browser
```

Astack's own `bash scripts/setup.sh --browser ...` selects the same way and records the choice in `env.sh`.

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
| `aside-browser` | Bundles the vendor Aside entry point as a managed skill, selected with `--browser aside` or `--browser both`. The file directs the agent to run `aside guide` for the live vendor instructions. |
| `browser-testing` | Shared browser QA policy: choose signed-in Aside or isolated browser-use, verify the observed URL and UI, and protect the user's tabs, profile and sessions. Installed on every backend; read the selected browser skill for live operation. |
| `browser-use` | Automates browser navigation, forms, screenshots, testing, and extraction. Selected by default, or beside Aside with `--browser both` (isolated testing only). |
| `commit` | Creates local milestone commits for coherent, workable, owned changes after verification. `implement` discovers and invokes it automatically; it never pushes, merges, tags, or releases. |
| `computer-use` | Operates desktop apps through local Cua Driver MCP with grounded input, screenshot forwarding, and verified outcomes. |
| `hindsight` | Uses Hindsight MCP memory with compact routine recall, project tags, safe retain, provenance checks, token-budget distinctions, and user-controlled deletion. |
| `implement` | Coordinates every tracked Work with session/Work/Task artifact paths, self-versus-delegate decisions, checks, and proportionate review while preserving specialized scope. A UI-changing implementation also hands its changed surface to `ui-ux-testing` in fix-or-flag mode after functional verification, unless the user opted out or asked for read-only review. |
| `page-performance` | Discovers and refreshes application pages, observes requests and load timings, investigates evidenced slowdowns, and verifies authorized fixes with comparable runtime evidence. |
| `pre-launch-mode` | Explicit opt-in posture for a named pre-launch scope: assume no customers or users even when the scope is deployed, prefer direct schema and code changes and fresh starts, and skip compatibility shims, migrations and hypothetical user-impact or rollback planning while protecting security, deployment and credential authority, unrelated workloads, and the operator data, integrations and consumer scope the user declared. |
| `push` | User-invoke-only skill that pushes existing local commits to an explicitly authorized remote and ref after applicable checks; it never commits, merges, tags, releases, or force-pushes. |
| `refactor` | Automatically refactors the current repository or project: a no-argument invocation resolves the cwd, discovers UI and backend opportunities that are present, starts ongoing idle-loop passes, reviews and verifies behavior-preserving changes, and honors explicit narrower scope or stop conditions. |
| `release-status` | Checks local and GitHub `main` package versions against npm with a read-only CLI and explains the dispatch-only trusted publishing workflow; publication authority stays with the human. |
| `retro` | Reviews a coding session for ways to improve the agent's working environment; invoke explicitly with `/skill:retro`. |
| `secret-handoff` | Conditional workflow when the current user, repository, or task assigns secret custody to the user: identify provider and target names, hand off the page or command, prepare only safe blank placeholders, and resume with names-only verification. It does not set a default policy for other projects. |
| `talk-human` | Writes clear, friendly, concise replies with plain language and exact technical detail. |
| `ui-conventions` | Finds the UI components, tokens and interaction patterns a repository already has before creating or restyling a control; respects project instructions and existing design systems without forcing migrations. |
| `ui-copy` | Writes and reviews interface text: cuts filler and restated labels while keeping required warnings, error text, labels and accessibility instructions. |
| `typescript-best-practices` | Applies type-system rules to TypeScript work: discriminated unions, branded types, boundary validation, exhaustive variants, and schema-derived types. |

These eighteen skills are the complete set this installer owns. Exactly one of the two browser skills is installed by default, so the default install is seventeen skills; `--browser both` installs all eighteen, and every non-browser skill is always installed. Some of them depend on other installed skills by name. Install the complete set rather than copying only `implement`, unless a host deliberately selects another browser backend with `--browser aside` or `--browser none`.

### Package-owned skills

The diagram, review and policy skills moved out of this repository into skill-only Astack packages. Names, helpers and licenses are preserved; `ui-ux-testing` in `pi-review` owns both the read-only audit contract and the authorized post-implementation disposition workflow. They are not part of this installer or its checksum manifest. Install each package and reload Pi:

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
| `pi-review` | `agent-review`, `awesome-logging-standards`, `codebase-design`, `no-arbitrary-limits`, `no-unit-tests`, `security-audit`, `ui-ux-testing` | `codebase-design` is the design reference for `design-council`, `implement` and `agent-review`. `security-audit` keeps Cloudflare's MIT-licensed guidance, schema, validators, license and pinned provenance. `no-unit-tests` and `no-arbitrary-limits` stay general task policies, not review-only rules. `ui-ux-testing` has a read-only review mode that reports findings and suggested fixes, plus an authorized post-implementation fix-or-flag mode that auto-fixes only clear in-scope defects, presents grounded decisions through `ui-ux-grill-me`, and rechecks every fix independently. |
| `pi-herdr` | `herdr`, `model-routing-policy` | Eight `Agent*` tools plus the editable routing defaults, described under [Herdr Core setup](#herdr-core-setup). |
| `pi-research` | `research`, `read-flows`, `design-council` | Also provides the one-shot `/ask` command and its reusable read-only guard. |
| `pi-grill-me` | `grill-me`, `ui-ux-grill-me` | Browser-based plan and UI/UX interviews with recorded answers. |
| `pi-firstmate` | `firstmate` | Coordinator mode extension and skill, described under [First Mate coordinator mode](#first-mate-coordinator-mode). |

Before migrating, inspect and back up the matching `~/.agents/skills/<name>/` directories, then remove them after verifying the package-owned skills load. The installer cannot remove directories that are no longer in its source tree. Pi keeps the first discovered skill and warns about a duplicate name, so do not keep both copies.

The `ui-ux-testing` skill moved into `pi-review` on 2026-11-04 and became a read-only audit that reports verified defects and suggested fixes. Remove its old global copy with the other package-owned skills. On 2026-11-17 an authorized post-implementation disposition workflow was added in that package. The two workflows were later consolidated into one `ui-ux-testing` skill: its review mode stays read-only, while fix-or-flag mode applies only after implementation authorization or an explicit user selection.

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

## Skill ownership map

These skills apply across tasks, so each shared concern needs one owner. The owner sets the rule; the boundary says what it does not authorize. Package-owned skills are included because they are installed with this set. Project instructions and explicit user requests still override every skill.

| Concern | Owner | Boundary |
| --- | --- | --- |
| Tracked work, artifact paths, self-or-delegate choice, review decision, final report | `implement` | Does not select models or perform independent review; `herdr` and `model-routing-policy` own delegation mechanics. |
| User-facing replies | `talk-human` | Messages only, not repository docs, code comments or interface text. |
| TypeScript files | `typescript-best-practices` | Type-system rules only; module design and product behavior stay with their owners. |
| Module responsibilities, interfaces, abstractions | `codebase-design` | Design reference; advice does not authorize implementation, tests or dependencies. |
| Existing UI controls, tokens and interaction patterns | `ui-conventions` | Discovery and reuse; no restyle, migration, consolidation or refactor permission. |
| Text inside a product UI | `ui-copy` | Not chat replies, documentation, release notes or marketing pages. |
| UI audit and evidence | `ui-ux-testing` | Its review mode is read-only for production source and reports findings without fixing them. |
| Post-implementation UI disposition | `ui-ux-testing` | Its authorized fix-or-flag mode fixes only clear in-scope defects against the existing design system; anything subjective needs the user. |
| Independent review of changes | `agent-review` | Read-only, and used when risk, breadth, uncertainty, an explicit workflow requirement or the user warrants it, not by default. |
| Automatic refactor discovery and execution | `refactor` | Default invocation resolves the current repository or project and runs ongoing, deduplicated, reviewed UI and backend passes; behavior changes need a human decision, explicit narrower scope is honored, and the invoking owner starts and owns an idle loop within its seven-day lifetime. |
| Data and schema compatibility assumptions | `pre-launch-mode` | Only when the user explicitly enables it for a named scope, and never inferred from a live deployment; it does not authorize deployment, production, credential or billing changes, or erasing operator data and integrations outside what the user declared disposable. |
| Secret values and credential handoff | `secret-handoff` | Conditional workflow only when the current user, repository, or task assigns custody to the user: names-only identification, explicit page or command handoff, safe blank placeholders, and resumable verification. It does not change unrelated projects' default policy. |
| Persistent personal/project memory | `hindsight` | Compact recall, retain, provenance, and tag guidance only. It does not set project policy, grant access control, or authorize deletion without a user request. |
| Subagent lifecycle and presentation | `herdr` | Starts, monitors and cleans up Core workers; Work/Todo records stay in `implement`. |
| Subagent model, thinking level and Fast mode | `model-routing-policy` | Subagents only; explicit user choices override its defaults. |
| Read-only investigation and design options | `research`, `read-flows`, `design-council` | No production edits; planning does not authorize implementation. |
| Unit tests and capacity limits | `no-unit-tests`, `no-arbitrary-limits` | Only the latest explicit user request permits unit tests; only verified platform/SDK constraints or explicit requests justify limits. |
| Browser testing policy and verification | `browser-testing` | Cross-cutting QA policy only; the selected browser skill owns the live browser and its current guide. |
| Browser and desktop automation | `aside-browser`, `browser-use`, `computer-use` | `aside-browser` owns the user's signed-in browser, `browser-use` isolated testing, `computer-use` desktop apps. |

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

- Run `npm run check` before installing, committing, or publishing. It verifies the manifest, then the installed/global equality. `npm run check -- --skill NAME` narrows only the installed/global part; the manifest step still runs. Running `scripts/check-repo.sh --skill NAME` directly performs only the global comparison.
- Automatic local milestone commits use the `commit` skill after `implement` discovers and invokes it. They cover only coherent, workable, owned changes with an empty pre-existing index, preserve unrelated and staged work, and run proportionate checks and hooks without bypass. Push uses the separate user-invoke-only `push` skill; merge, tags, publication, and deployment require separate explicit authorization.
- `npm run check:manifest` verifies `skills-manifest.json` alone: every recorded SHA-256 and executable mode must match the repository, and `skills/` may not contain a missing, stale or unlisted file. It needs no global install.
- Keep credentials in environment variables or provider login stores, never in skills or examples.
- Do not commit Pi settings, sessions, Herdr configuration, generated `var/` evidence, package caches, or `node_modules/`.
- Review upstream extension release notes before updating pinned versions.
- Keep skill instructions concise and easy to audit.
- Preserve file modes when copying or packaging skills.
- Third-party names and links are informational; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Repository layout

```text
skills/                       Shared Agent Skills directories (Pi, Codex, OpenCode)
skills-manifest.json          Exact skill file checksums and executable modes
scripts/install.sh            Conflict-safe additive global installer and uninstaller
scripts/check-manifest.py     Manifest checksum and executable-mode verification
scripts/check-repo.sh         Repository/global skill equality check
scripts/trees-equal.py        Shared exact tree comparison and mismatch report
third_party/licenses/         Required upstream license texts
package.json                  Repository metadata and check command
```

## License

The repository's original packaging and documentation are available under the [MIT License](LICENSE). Redistributed material keeps its upstream terms and required notices in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`third_party/licenses/`](third_party/licenses/).
