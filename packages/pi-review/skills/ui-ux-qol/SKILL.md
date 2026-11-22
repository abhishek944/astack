---
name: ui-ux-qol
description: "Repeatedly find small evidence-backed UI/UX quality-of-life improvements for a named surface, deduplicate them in persisted state, and hand human-selected changes to ui-ux-grill-me. Discovery never edits production UI, makes provider calls, creates loops, or uses a scheduler."
license: MIT
compatibility: "Requires an authorized target surface, read-only browser or desktop inspection, the global implement and talk-human skills, ui-conventions, ui-copy, no-unit-tests and no-arbitrary-limits. Presenting choices requires ui-ux-grill-me with pi-decisions and pi-loop-monitor. Recurring operation is owned by the parent session through pi-loop-monitor."
---

# UI/UX quality-of-life discovery

Find one small, real UI or UX improvement at a time. Show the evidence, remember what was already suggested, and let the human choose. Change nothing in the product before that choice.

Before replying, follow the global `talk-human` skill. Follow `implement` for Work/Todo ownership and artifact paths, `no-unit-tests` for verification limits, and `no-arbitrary-limits` for scope. Use `ui-conventions` and `ui-copy` as the evidence sources for repository-owned design and text rules.

## Ownership

- `pi-review` owns this skill: candidate discovery, evidence, deduplication, and reporting.
- `ui-ux-grill-me` owns the visual interview, question delivery through `pi-decisions`, response archives, and the visual contract for a selected candidate.
- `implement` owns any authorized fix and its functional verification. `ui-ux-testing` owns full UI/UX audits, rendered contrast, outer-frame geometry, and post-implementation fix-or-flag disposition.
- `pi-loop-monitor` owns recurring wakes. The parent session owns the loop. This skill never creates or deletes loops or uses a scheduler; a loop-owned wake may call `LoopUpdate` exactly once for its own dynamic loop.
- No provider calls: do not call image generation, classifiers, hosted search, or another external model/provider API. If a claim needs such a call, report it as a limit instead of making the call.

## Read-only discovery contract

Production source, user-visible UI, settings, data, services, and dependencies stay unchanged until the human selects a candidate and a separate authorized implementation step begins.

The only writes allowed during discovery are:

1. evidence and notes inside the canonical owner task directory from `implement`;
2. the package-owned dedupe ledger described in [state and loops](references/state-and-loops.md).

Opening menus, navigating read-only routes, resizing a viewport, and capturing screenshots are allowed when the target authorization permits them. Do not submit forms, trigger paid or destructive actions, restart services, install tools, or bypass authentication.

## What counts as a quality-of-life candidate

A candidate must satisfy all three tests:

1. **Live evidence.** Capture the actual surface at its real route, viewport, theme, and interaction state. Keep the screenshot and the exact reproduction path in the owner task directory. A source-only hunch is not a candidate.
2. **Repository-owned reason.** Name the contract the observation contradicts or strains: an existing component or token from `ui-conventions`, a rule from `ui-copy`, a documented flow, an accessibility requirement, or observed behavior that blocks or slows a real task. Do not invent a metric or call personal taste a defect.
3. **Small scope.** The improvement is localized, reversible, and does not change visual direction, hierarchy, navigation, density, copy intent, a shared component's API, or add a dependency. If it does, or if the behavior looks broken, hand it to `ui-ux-grill-me` for a design decision or `ui-ux-testing` for a full audit rather than treating it as a quick improvement.

Write one candidate per pass and one decision branch per candidate. If no candidate passes these tests, report `NO_CANDIDATE` and keep the loop state current.

## Persisted deduplication

Use the ledger contract in [state and loops](references/state-and-loops.md). Before proposing anything, read `var/pi-review/ui-ux-qol/state.json` in the target repository. Compare the stable candidate ID and evidence fingerprint. Never re-present a proposed, accepted, deferred, rejected, or implemented candidate. If the source or evidence materially changes, record a new candidate ID rather than silently reinterpreting an old decision.

The ledger stores IDs, status, evidence references, and timestamps only. It never stores screenshots, private data, credentials, tokens, or raw transcripts. If the ledger is missing, create it; if it is malformed, stop with `BLOCKED` and report the exact path instead of overwriting it.

## One bounded pass

1. Confirm the target repository, surface, route, supported states, and read-only authority. Establish a real Work/Todo owner with `implement` before project inspection.
2. Read project instructions, related flow documentation, the existing design system, and the ledger.
3. Observe the live surface with the smallest safe interaction. Capture the current state at the useful size, not a full page when the decision concerns a panel or control.
4. Compare one observation with one repository-owned contract. Reject guesses, subjective polish, and broad refactors.
5. If a candidate passes, create its evidence record and ledger entry with a stable ID. If a human decision is already pending for that target, leave it pending and do not open another question.
6. When a human is present and no decision is pending, hand the candidate to `ui-ux-grill-me`'s branch workflow. Its `SubmitQuestion` tool owns delivery; this skill does not call it directly. Share the returned URL and wait through its `WaitForAnswer` watcher.
7. A human selection authorizes only the selected branch. Hand it to `implement` for the scoped fix. Use `ui-ux-testing` when the fix needs an audit or independent recheck. Update the ledger only after the verified outcome is known.
8. If invoked from a dynamic loop, call `LoopUpdate status="continue"` exactly once after the pass, carrying state and metrics. An empty or unchanged pass is not a reason to delete or complete the loop.

## Loop safety

The parent session decides whether to create a recurring wake. The safe trigger, prerequisites, and seven-day platform expiry are documented in [state and loops](references/state-and-loops.md). This skill must not create a loop or invoke a scheduler, even when the user wants continuous operation.

A hard read-only loop guard is not sufficient for the full workflow because it blocks ledger writes and `SubmitQuestion`. Use a parent-owned dynamic idle wake whose prompt enforces this skill's narrow write set, or separate read-only discovery from a normal-turn interview. Preserve one open decision per target.

## Blockers and reports

Report `BLOCKED` with the exact dependency when live access, ledger access, interview tooling, user authority, or a valid target surface is missing. Report source-only observations separately from runtime evidence.

End with the candidate ID and status, live evidence path, repository contract, ledger path, question and response paths if a human decided, implementation or audit handoff if authorized, and the next loop state. Never claim a UI change is done because a suggestion was written or a build passed.
