# pi-review

Eight skill-only Pi workflows for reviewing changes, designing modules, auditing security, auditing
UI/UX, applying authorized UI follow-through and keeping implementation scope honest:

| Skill | Purpose |
| --- | --- |
| `agent-review` | Runs an independent reviewer on repository changes when risk, complexity, uncertainty, or an explicit user request justifies it. |
| `codebase-design` | Guides module responsibilities, explicit interfaces, justified abstractions, and version-aware TypeScript/Effect contracts. |
| `security-audit` | Provides Cloudflare's source-first security guidance and evidence-led audit workflow with independent validation and structured reports. |
| `awesome-logging-standards` | Guides structured application and error logs, redaction, request summaries, and TypeScript/Node.js or Effect integration. |
| `no-unit-tests` | Prevents unit-test creation, editing or execution unless the user explicitly asks for unit tests. |
| `no-arbitrary-limits` | Prevents unrequested capacity limits and implementation-time questions about optional limits, and reports optional controls after completion. |
| `ui-ux-testing` | Runs a read-only UI/UX audit with parallel auditors and reports verified defects, evidence, suggested fixes and a fix class per finding; the caller owns scope, fixes and delegation. |
| `ui-ux-followthrough` | Owns post-implementation UI disposition and flag-mode review of a named UI surface: runs a read-only audit, then auto-fixes clear in-scope defects after an implementation or flags a user-specified UI scope through `ui-ux-grill-me` before any fix; each grounded decision branch is presented as soon as its own evidence and dependencies close, while the remaining audit keeps running, so the user never waits for the full audit or synthesis report. A named review with no prior implementation starts read-only, and it adds no permission and rechecks at runtime. |

This package contains only skill instructions and their bundled references, companion documents,
schema, validators and licenses. It registers no extension code or custom tools.

## Install

Requires Pi 1.4.0 or newer and Node.js 22 or newer. `security-audit` full audits additionally
require independent agents and an OS-enforced sandbox before executing target code.
`ui-ux-testing` audits also require an accessible application and authorized browser or desktop
automation; the audit reports findings without editing production source. `ui-ux-followthrough`
builds on that audit inside an authorized implementation task and adds no permission of its own;
its flag mode additionally needs `ui-ux-grill-me`, which requires `pi-decisions`,
`pi-loop-monitor` and browser automation, plus Herdr Core and continuous monitoring for delegated
owners. Flag mode presents each decision branch as soon as that branch's evidence is verified and
its dependencies are resolved, shares the returned decision URL immediately, and keeps the
remaining read-only audit running rather than holding choices until a synthesis or final report.

From an Astack checkout:

```sh
pi install ./packages/pi-review
```

Or use the package directory's absolute path:

```sh
pi install /path/to/astack/packages/pi-review
```

Run `/reload` in an open Pi session, or restart Pi, after installing or changing packages. Confirm
the package is configured with `pi list`.

The package is not published on npm. Publish manually from this directory when a release is
intended.

### Migrating from the shared skills repository

All seven migrated skills were previously owned by the `pi-herdr-skills` shared skill repository and
its global installer. This package is now their source of truth. Names and audit coverage are
preserved; `ui-ux-testing` now reports verified findings and suggested fixes without editing
production source or implementing them, and `ui-ux-followthrough` is new to this package: it owns
the authorized disposition of those findings without moving repair permission into the audit.

If the old global copies exist, inspect and back up `~/.agents/skills/<skill>/` for these seven
names, then remove those directories after the package is configured. The shared installer does not
remove retired directories automatically. Do not keep both the global copies and the package
loaded: Pi keeps the first discovered skill and warns about the duplicate name.

`no-unit-tests` and `no-arbitrary-limits` are general policies, not review-only rules. They apply
to every implementation, fix, refactor, migration and maintenance task in any workflow that reads
them, exactly as before the move. `agent-review`, `codebase-design` and `awesome-logging-standards`
are referenced by name from other installed skills; keep this package installed so those
references still resolve.

`security-audit` keeps its upstream companion documents, report schema, zero-dependency validators,
license and pinned provenance. Installing the package does not run an audit or install sandbox
tooling.

## Licensing

The package's original packaging and documentation, including `agent-review`, `no-unit-tests`,
`no-arbitrary-limits`, `ui-ux-testing` and `ui-ux-followthrough`, are MIT licensed; see
[LICENSE](LICENSE). Redistributed material keeps its upstream terms and bundled license texts. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
