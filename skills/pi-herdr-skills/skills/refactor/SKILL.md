---
name: refactor
description: "Automatically refactor the current repository or project with evidence-backed UI and backend passes: no-argument invocation resolves the cwd, discovers opportunities, starts an ongoing idle loop, reviews and verifies behavior-preserving changes, and honors explicit narrower scope."
compatibility: "Requires pi-tasks, pi-loop-monitor, the global implement and talk-human skills, codebase-design, agent-review, no-unit-tests and no-arbitrary-limits. UI work also needs the host browser guidance and ui-ux-testing. The invoking owner creates and owns the default automatic idle loop when pi-loop-monitor and host permissions allow."
---

# Evidence-backed refactoring

Invoke `/skill:refactor` with no arguments to refactor automatically: resolve the current working repository or project, discover UI and backend opportunities that are actually present, start ongoing idle-loop passes, and implement only reviewed behavior-preserving changes. Choose one real opportunity at a time, prove it with current evidence, get it reviewed, and verify the result before recording success. This skill never assumes a framework, route, service, data store, or deployment model.

Follow `talk-human` for replies and `implement` for Work/Todo ownership, artifact paths, authorization, and verification. Follow `no-unit-tests` and `no-arbitrary-limits`. Use `codebase-design` before changing responsibilities, interfaces, or abstractions. Use `agent-review` for the actual diff. For UI work, use the host's selected browser skill, `ui-conventions`, `ui-copy`, and `ui-ux-testing` where they apply.

Invocation authorizes automatic operation on the resolved target: discovery, loop creation, reviewed behavior-preserving implementation, and verification. Do not ask for a repository, component, duration, or stop condition when they are omitted. Explicit arguments that name a narrower target, surface, path, check, finite run, or stop condition override the defaults and must not be broadened. Host permissions and policies still control available tools; report `BLOCKED` with the exact dependency when they prevent the automatic workflow instead of silently downgrading to a one-off pass. Do not commit, push, publish, deploy, install dependencies, change credentials, touch another account, or run paid or destructive actions.

## Ownership

- The owning session creates Work and Todo records and keeps them current. Each pass gets an active Todo; evidence and review artifacts stay in that task's canonical `var/<sessionId>/<workId>/<taskId>/` directory, or the nested directory defined by `implement` for delegated work.
- `pi-loop-monitor` owns recurring wakes. For the default automatic invocation, the invoking owner must proactively create the idle loop as soon as the target, scope, and prerequisites are resolved if the tool and host permissions allow; do not leave activation ambiguous or wait for another instruction. The owner then controls the loop and reports its state. If creation is unavailable, report `BLOCKED` with the exact dependency. Create no loop when the invocation explicitly requests a single bounded pass.
- Discovery is read-only with respect to product code and runtime data. The dedupe ledger and owner-task evidence are the only writes before an implementation decision.
- `design-council` or `codebase-design` reviews candidate design; `agent-review` reviews the actual change. A human decision is required for behavior changes and material scope expansion.
- `implement` owns implementation and functional verification. `ui-ux-testing` owns post-implementation UI disposition when the changed surface is user-visible.

## Mechanical repeat path

A previously verified, demonstrably mechanical candidate may use a shorter pre-edit review. This path changes only the depth of the pre-edit review. It never removes current evidence, a candidate brief, `implement` ownership, decision gates, verification, or independent `agent-review` on the actual diff.

Use it only when all of these are true:

- The ledger records a `verified` precedent for the same repository, area, and change axis, with evidence, review, and verification references.
- The current candidate is a bounded repetition of that precedent: the same operation, surface class, and invariant. No new abstraction, module responsibility, interface, dependency, data shape, navigation, authentication, security, or user-visible behavior change.
- A repository-owned, already verified harness, scanner, linter, or check identifies the current occurrence and can verify the invariant. Reuse it instead of writing a parallel one-off scan; record the exact command and why it is sufficient. If no such check exists, use the full path.
- The brief names the precedent ID and records why the current evidence and invariant match it.

In step 5, confirm those facts and record a short pre-edit note instead of a full design review. If any fact is missing or the diff expands, return to the full pre-edit review. Step 8 still requires the applicable checks and independent `agent-review` on the actual diff, using the brief, invariant, precedent, and verification evidence as its contract. Never record `verified` until that review and the checks pass.

## Deduplicated opportunity state

Keep one package-owned ledger per target repository:

```text
<repository-root>/var/pi-herdr-skills/refactor/state.json
```

This is runtime state, not an agent task artifact. Store only stable IDs, status, short descriptions, evidence references, review/decision references, verification references, and timestamps. Never store credentials, tokens, secrets, personal data, raw logs, or full transcripts.

Read the ledger before discovery. Give each opportunity a stable ID derived from the target, area, change axis, and evidence fingerprint. Never re-propose a candidate whose status is `approved`, `implemented`, `verified`, `rejected`, `deferred`, or `obsolete`. A deferred candidate may return only when its recorded revisit condition is actually met; create a new ID when material evidence changes. Keep one `proposed` candidate per target until its review is resolved. Preserve history; do not prune, cap, or silently rewrite it. Write atomically from one owner at a time. A missing ledger can be created; a malformed or unreadable ledger is `BLOCKED` and must not be overwritten.

Suggested candidate statuses are `observed`, `proposed`, `approved`, `implemented`, `verified`, `rejected`, `deferred`, `obsolete`, and `blocked`. Record why each terminal status was reached and link the full evidence in the owner task directory.

## One bounded pass

1. **Resolve target and scope automatically.** With no arguments, treat the repository or project containing the current working directory as the target, include both UI and backend wherever they are present, and use ongoing passes with no predefined stop condition. Do not ask for the repository, component, duration, or stop condition. Explicit arguments narrow the target, surface, paths, checks, finite run, or stop condition; honor them without broadening. Verify that the target is a recognizable repository/project and that tracking, loop, discovery, review, and implementation prerequisites are available. Establish the owner Work/Todo before inspecting project files. Read project instructions, relevant flow documentation, and the ledger. If the cwd is not in a recognizable repository/project, the target is ambiguous, or a prerequisite is unavailable, report `BLOCKED` with the exact dependency; never invent a target from memory, a parent directory of an unrelated cwd, or a recent session.
2. **Collect current evidence across present surfaces.** Discover opportunities in the resolved target rather than a preselected component. Reuse repository-owned, already verified scanners, linters, analyzers, and check commands when they can produce the needed current evidence; confirm their scope and record the exact invocation. Do not invent a parallel one-off scan or treat an unvalidated tool as proof. For UI, observe the real rendered surface at its route, state, viewport, and theme using the host browser guidance; keep only sanitized screenshots, console categories, and request summaries. For backend, use local source, safe logs, traces, metrics, or a controlled runtime request that does not mutate shared state. Verified source facts, such as concrete duplication, coupling hotspots, dead paths, or contract inconsistencies, can establish a backend opportunity without runtime observation; record them as source evidence, not runtime evidence. For cross-layer work, `page-performance` supplies the comparable measurement method. UI opportunities still need current rendered evidence. A vague hunch, an old screenshot, or an assumption about production is not sufficient.
3. **Write the candidate brief.** Name the observed fact, repository-owned rule it contradicts or strains, affected files or surfaces, expected benefit, and the exact behavior that must remain unchanged. Include the baseline observation and a verification plan. If no candidate qualifies, record `NO_CANDIDATE` in the pass record and ledger state; do not invent work.
4. **Prioritize.** Choose the highest-priority candidate that has no active owner and no unresolved decision. Consider direct user value, evidence strength, risk, reversibility, dependency readiness, and scope. Prefer a reproducible observation over a static guess and a reversible local change over a cross-cutting migration. Record the tie rationale when priorities are close.
5. **Obtain review before editing.** For novel or risky candidates, have an independent reviewer examine the candidate brief and evidence. Use `design-council` for a consequential design choice and `codebase-design` for module responsibility or interface changes; for a small mechanical change, an independent reviewer can apply `codebase-design` directly. A candidate that qualifies for the mechanical repeat path instead records the verified precedent and its applicability in a short pre-edit note. Record findings and answer them in the brief. Do not implement when the evidence is weak, the invariant is unclear, or the verification plan cannot run.
6. **Get a decision when behavior may change.** A refactor is behavior-preserving by default. Externally observable API contracts, data shape or persistence, auth and permissions, navigation, rendered copy or layout, error semantics, security properties, dependency changes, and production or destructive effects are not refactor details. If a candidate would change any of them, stop and obtain an explicit human decision through `pi-decisions` when available or in conversation. Record the decision before implementation. If the decision is withheld, mark the candidate `blocked` and choose another independent candidate.
7. **Implement the reviewed scope.** Follow `implement`: preserve unrelated and staged changes, edit only owned files, and stop if the diff would expand scope. Keep the behavior invariant explicit. If implementation reveals an unavoidable behavior change, return to the decision gate; do not silently absorb it.
8. **Verify and review the result.** Rerun the evidence that justified the candidate under comparable conditions, including any reused harness or scanner from step 2: source-level duplication or coupling checks for a source-evidenced structural change, and the affected runtime flow when the candidate concerns behavior, performance, UI, or integration. Run the repository's applicable non-unit checks, such as typecheck, build, lint, and schema validation. Runtime verification is proportionate to risk and availability, but never claim an end-to-end pass that was not run. If a runtime check is unavailable, record it as **NOT RUN** with its exact dependency and report the result as source-level or incomplete. For user-visible UI, complete `implement`'s `ui-ux-testing` handoff. Then require `agent-review` on the actual diff, with the candidate brief, invariant, applicable precedent, and verification evidence as its contract. Resolve every concrete finding or mark the candidate `blocked`; never record `verified` on an unreviewed or failed change.
9. **Record and hand off.** Update the ledger only after the review and verification outcome is known. Write a compact pass record with candidate ID, status, baseline evidence, changed files, checks and results, evidence paths, pre-edit review or repeat-path note, actual-diff review path, decision reference, ledger outcome, and remaining work. Give the next pass enough state to avoid repeating the same candidate.

A pass that discovers no candidate, finds a valid candidate already under review, or must wait on a decision is not a failure. Report it accurately and keep the owner task and ledger current.

## Refactor safety contract

- Preserve externally observable behavior unless a human explicitly approved that change as a separate scope.
- Do not introduce unrequested capacity limits, retries, queues, caches, or other runtime machinery. Follow `no-arbitrary-limits`; only verified mandatory platform constraints or explicit requirements justify a limit.
- Do not rename or reorganize code merely to satisfy taste. Tie every edit to the candidate's evidence and invariant.
- Keep authentication, authorization, validation, cancellation, data integrity, and sensitive-input handling intact.
- Do not add unit tests or run unit-test commands unless the latest explicit user request asks for them.
- Do not combine an unrelated cleanup with a candidate just because the files are open.

## Agent-paced recurring operation (default)

Default invocation is ongoing. Once the target, scope, and prerequisites are resolved, the invoking owner must proactively create this loop now with `pi-loop-monitor`, subject to host permissions; do not ask for a duration or stop condition, defer activation, or merely describe the loop. Do not use a scheduler or shell sleep loop. An explicit narrower scope, finite run, or stop condition overrides this default without broadening it:

```text
LoopCreate
  trigger="idle"
  triggerType="idle"
  recurring=true
  readOnly=false
  prompt="Run one bounded refactor pass for the resolved repository/project and explicit scope using the refactor skill: collect evidence, update the owner task and dedupe ledger, obtain the required review and decisions, implement the reviewed in-scope refactor when authorized, verify it, and call LoopUpdate exactly once for this loop with the appropriate status (continue, paused, or completed) and current state."
```

Omit `maxFires` for the default ongoing goal. Use `maxFires` only when the invocation explicitly requests a finite run. With no predefined stop condition, continue while the authorized goal remains and the controller is alive; this does not make the controller permanent. Do not set a cron or fixed `nextInterval` as the default; idle means the next wake is queued when the agent becomes idle. A hard `readOnly` loop cannot run the full workflow because it blocks ledger writes, decisions, and implementation.

Every dynamic wake calls `LoopUpdate` exactly once for its own loop ID before ending the turn:

- `status="continue"` with current state and metrics while the authorized goal remains, including an empty or unchanged pass. Omit `nextInterval` to stay idle-paced.
- `status="paused"` only for a genuine blocker that needs a user decision or another agent's output.
- `status="completed"` only when an explicit stop condition is satisfied or the authorized goal is otherwise done. Do not complete merely because one pass found no candidate. Do not hard-code `continue` in the loop prompt; choose the status from the pass outcome.
- Do not use `LoopDelete` after a normal empty pass; it is for explicit cancellation or a satisfied stop condition.

The controller is session-scoped. Recurring loops expire after seven days and are then retired; the expiry wake is not a permanent failure, but the workflow is not infinite. If the user's ongoing request remains after expiry, the invoking owner must explicitly recreate the loop after the expiry wake when permissions still allow, carrying forward the ledger and owner-task state; otherwise report the exact limit. Do not claim continuous coverage beyond the controller's remaining lifetime.

## Blockers and reports

Report `BLOCKED` with the exact dependency when the cwd is not in a recognizable repository/project, the target is ambiguous, loop creation or another required prerequisite is unavailable under host permissions, the ledger is malformed, credible discovery evidence is unavailable, review tooling is missing, a behavior-change decision is pending, required implementation permissions are absent, or another owner controls the surface. Record unavailable runtime checks as **NOT RUN** with their dependency rather than claiming a runtime result.

End each pass with a concise outcome, then the candidate ID and status, baseline observation and evidence path, changed files if any, checks/results, pre-edit and actual-diff reviews, verification results, limitations and any **NOT RUN** check with its exact dependency, ledger outcome, and loop state including seven-day expiry. Use the canonical task artifact paths from `implement`; point to the full record instead of pasting logs. Never claim a refactor is complete because a suggestion was written, a review was requested, or a build passed.
