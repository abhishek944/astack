---
name: ui-ux-followthrough
description: "UI follow-through after implementation, plus flag-mode review of a named UI surface. Runs the read-only ui-ux-testing audit, then either auto-fixes clear in-scope defects that contradict the repository's existing design system after an implementation, or flags a user-specified UI scope through ui-ux-grill-me so the user can choose, modify or skip before any fix. Flag mode presents each grounded decision as soon as its branch has verified evidence, sharing the decision URL immediately while the remaining read-only audit keeps running, instead of waiting for the full audit or a synthesis report. A named UI review with no prior implementation starts read-only. Adds no permission, performs no subjective redesign, never edits product UI outside the authorized scope, and rechecks every fix at runtime."
compatibility: Requires the installed read-only ui-ux-testing audit, authorized runtime UI access, and either an implement-authorized task or an explicit user request to review a named UI surface. Flag mode additionally requires ui-ux-grill-me with pi-decisions and pi-loop-monitor; delegated audit, repair and recheck owners require Herdr Core and continuous monitoring.
---

# UI/UX Follow-through

After implementation and its functional verification, decide what actually happens to the UI evidence: fix only what is clearly broken and already in scope, ask before anything else, and never restyle on your own.

This skill owns the disposition of UI findings and the authorization for any repair. It does not own the audit and it does not own the feature implementation. Before replying, follow `talk-human`. Follow `no-unit-tests`; UI follow-through never authorizes unit tests.

## Where this fits

```text
implementation (implement) → functional verification (implement)
  → read-only UI audit (ui-ux-testing)  ─┬→ branch evidence ready
                                          ├→ present that decision (ui-ux-grill-me) → authorized fix
                                          └→ keep auditing the remaining lanes
  → independent read-only recheck (ui-ux-testing) → report that reconciles every branch
```

- `implement` owns implementation, functional verification, integration and the final claim.
- `ui-ux-testing` owns inspection, evidence, coverage verdicts and the per-finding fix class. It stays read-only, including inside this workflow.
- This skill owns the decision and the authorization: which findings become fixes, which become user decisions, and which stay reported. It runs inside an `implement` task, or as the standalone flag-mode review a user asked for, and adds no permission of its own.
- `ui-ux-grill-me` owns the flag-mode interview and its recorded decisions.
- The read-only recheck is owned by someone other than the fix author, still through `ui-ux-testing`.
- Presentation is progressive and default: a grounded branch reaches the user as soon as its own evidence and dependencies close, while the remaining audit continues in parallel. The audit's synthesis and its report close the work; they never gate the first decision.

Use `ui-ux-testing` directly for a plain audit, and `ui-ux-grill-me` directly for open-ended design exploration. This workflow finishes already-authorized implementation work and, in flag mode, answers a review request for one named UI surface; it is not a route for starting a broad UI project. Invoke it explicitly from the `implement` task or from the user's review request, or when its description matches; never attach it to unrelated implementation work.

## When this applies

Two entry paths, both narrow:

1. **Post-implementation (auto-fix default).** An `implement` task changed a user-visible UI surface, functional verification is complete, and the user has not opted out or asked for read-only review. `implement` hands the changed surface here, and the phase and mode are recorded as the hand-off starts — not before the implementation.
2. **Named UI review (flag only).** The user asks to review, improve or judge a specific UI surface, with no implementation behind it. Start read-only: audit that surface and interview each decision branch as its own evidence closes. Nothing is auto-fixed, nothing changes before the user decides, a skip ends only that branch, and a stop ends the review.

It does not apply, and must not be forced, when:

- the task touched no user-visible UI and the user asked for none — do not turn ordinary implementation work into a UI task;
- a read-only audit, research or planning request named no UI surface to review — report and stop;
- the finding belongs to an earlier, unrelated audit, or to a surface outside the authorized scope;
- the change would need a design decision, a new dependency, a design-system migration or a cross-directory consolidation. That is a flag, never an auto-fix.

## Authorization and safety

- A repair inherits the implementation task's authorization, owned files, allowed checks and permission prompts. This workflow grants nothing beyond it; when an action needs permission, ask for that permission rather than routing around it. In the named-review path the user's own selection is the authorization: it covers exactly the selected changes on the named surface and nothing else.
- Do not add UI dependencies, swap a styling system, migrate the design system, restructure folders or rename shared components.
- Do not commit, push, publish or deploy unless the user asked.
- Do not bypass authentication, fill credentials, trigger paid or destructive actions, or change persistent account settings.
- Touch only the surface the implementation changed or the user named. Everything else stays in the report as an unowned observation.
- One owner per file at a time. If the smallest correct fix needs a file another owner holds, or a shared component nobody assigned, the finding becomes a flagged decision or a blocker — not a quiet edit.
- Keep captures and reports inside the task artifact directory. Never rewrite the auditor's report as if the auditor had written the fix; write a separate disposition document beside it.

## Required order

**Post-implementation path**

1. **Implementation** by `implement`, on the surface being reviewed.
2. **Functional verification** by `implement`, before any repair decision. This is a gate, not a formality.
   - When functional verification is blocked, incomplete or **NOT RUN**, the repair phase stops. Read-only UI evidence may still be collected and reported, but behavior-dependent findings stay **BLOCKED**, are not auto-fixed, and must not be "fixed" by hiding the symptom.
   - Never treat a UI symptom of an unverified functional defect as a layout problem: a spinner that never clears, error text that never appears or a button that does nothing is first a verification blocker. Report it with the missing flow and what would unblock it.
3. **Read-only UI audit** through `ui-ux-testing`, told the mode, the authorized surface and the functional-verification state. The baseline must be the current runtime, not a stale capture or a fixture.
4. **Disposition** of each finding from its fix class as its evidence lands, not only once the whole audit is assembled. Auto-fixable findings keep their own conditions; a finding that becomes a decision opens that branch immediately.
5. **Present every ready decision branch as soon as it is grounded**, through `ui-ux-grill-me`, while the remaining audit lanes continue. Do not make the user wait for the audit's synthesis or final report to make the first choice.
6. **Fixes only as the mode authorizes**, per finding or per resolved branch, as those resolutions arrive.
7. **Read-only recheck** of every fix by an owner independent of the fix author.
8. **Report** the disposition per finding, with evidence, checks and limits. The report closes the workflow; it is never a prerequisite for presenting decisions.

**Named UI review path**

1. The user names the surface. Read project instructions, the design system and the current runtime state first.
2. **Read-only baseline audit** of that surface only, through `ui-ux-testing`; observe its current behavior where that is safe. There is no implementation to verify, so behavior that cannot be observed stays an observation rather than a pass claim, and nothing here authorizes a change.
3. **Present each decision branch as soon as its evidence is ready**, through `ui-ux-grill-me`, while the remaining audit lanes keep running. The first branch must not wait for the audit's synthesis or final report.
4. **Fixes only from resolved selections or explicit authorization**, one decision at a time, inside the files that surface owns and under the normal permission rules. A resolved branch may be fixed while other branches are still being audited or decided. Skipped, deferred and unselected items stay untouched.
5. **Read-only recheck** of each changed state at runtime as its fix lands, then the report that reconciles every branch.

Both paths end at the report; neither may open a broader UI scope than the one named.

## Declare the mode before the audit

Record the mode and the authorized surface in the work plan and task record, and pass both to the audit. On the post-implementation path that happens as `implement` hands off; on the named-review path it happens when the review is set up. In flag mode, declare the branch plan and level order with it, so a branch can open later without renegotiating the mode. Mixed dispositions within one task are normal; silently switching modes is not.

### auto-fix — default for the implementation's own surface (post-implementation path only)

A finding may be auto-fixed only when **all** of these hold:

- it was reproduced live in the current runtime;
- it violates a contract the repository already owns — a shared design-system component or token, a `ui-conventions` interaction rule, a `ui-copy` rule, an accessibility requirement, real clipping or overlap of content or controls, or spacing that contradicts the adopted scale or the equivalent shared component;
- it is localized to the authorized surface and the files this task already owns;
- it requires **no design decision**: no change to visual direction, hierarchy, navigation, information architecture, density, copy intent, component API or dependency;
- the smallest fix reuses or extends the existing component, tokens and copy rules rather than restyling, copying markup or adding a lookalike;
- the fix is verifiable by a repeatable runtime case at the same route, viewport, theme and data state.

If any condition fails, it is not an auto-fix. Choose flag mode or report it.

### flag — required for user-specified UI scope and for decisions

Use flag mode when:

- the user specified a UI scope to change, improve or evaluate beyond a clear defect, including a named UI surface reviewed with no prior implementation;
- the audit classified a finding **needs-user-decision**;
- a fix would change direction, hierarchy, navigation, density, layout structure or copy intent, or would introduce a pattern, component, dependency or variant;
- the fix spans directories or shared components enough to be a consolidation decision;
- the repository's written rule and its current code disagree and choosing a side is an architecture or dependency decision;
- findings conflict, or the audit could not reproduce the state it was asked about;
- functional verification is blocked for the behavior a finding depends on.

Flag mode is never satisfied by asking in chat, by picking the "obvious" option for the user, by implementing the recommended variant as a default, or by treating silence as consent.

## Present each decision as soon as its branch is ready

Progressive presentation is the default for flag mode, not an opt-in variation. The user must not wait for an entire audit, a synthesis pass or a final report before seeing the first grounded decision.

Replace "audit everything, then interview" with "present each branch as its evidence closes":

1. **Split the authorized scope into decision branches**, one primary axis each, from the audit's coverage matrix and the observed findings. Shared foundations — layout, navigation, design tokens, the component and interaction model — come first; independent branches follow.
2. **Judge readiness by evidence, not by report status.** A branch is ready when it has everything a decision page needs: the current state captured live as a screenshot at the real route, viewport, theme and data state and compared at matching dimensions; the observed issue reproduced, or explicitly labelled unverified; grounded alternatives that reuse existing tokens and components; the repository contract each option is judged against; and every dependency verified resolved.
3. **Present a ready branch immediately**, through the `ui-ux-grill-me` branch workflow, even while other audit lanes are still running, still reporting or still blocked. Share the URL `SubmitQuestion` returned as soon as that submission succeeds, then call `WaitForAnswer` for the branch.
4. **Keep the read-only audit running concurrently.** Independent lanes continue inspecting the rest of the surface. Give each lane and branch owner its own page and, where storage or theme state is shared, its own browser context; never let two owners drive the same page or focused desktop at once, and inherit `ui-ux-testing`'s safety rules unchanged. An unverified lane keeps its findings out of decision pages; it never holds back another branch that is already grounded.
5. **Keep one open question per branch owner, not one globally.** Independent, dependency-free branches may have concurrent open questions in separate pages. Respect `ui-ux-grill-me`'s DAG and level rules: a branch whose input is another branch's choice waits for that decision, and foundation levels integrate before dependent levels open.
6. **Apply a resolved branch while the rest continues.** That branch's selection authorizes exactly its own scoped fix. Do not delay a resolved branch until every branch resolves, and do not fix a branch that has no decision yet.
7. **Reconcile late evidence honestly.** When a later audit finding contradicts an already-presented option, or the state it depended on changed, reopen that branch with corrected evidence and a fresh question ID. Never rewrite or silently reinterpret what the user already saw under the same question, and never keep a decided branch the new evidence invalidates without saying so.
8. **Keep a blocked branch local.** A branch whose evidence is blocked, whose tooling is unready or whose dependency is undecided is marked blocked on its own. Other ready branches keep presenting and resolving; the blocked branch is reported with its exact dependency and what would unblock it.

The final report still closes the workflow and reconciles every branch, including the ones still pending when the work stopped. Presentation order is evidence-driven: do not hold a grounded branch back for the report, and do not present a branch early to keep the workflow moving.

### Skip, defer and stop

- **Skip** applies to one branch. That decision is not a requirement, is never implemented later "to finish the job", and the remaining branches continue.
- **Defer** keeps a branch unselected with its revisiting condition. Dependents that required it are re-scoped or deferred too, never guessed.
- **Stop** ends the whole review. Preserve every branch's evidence and every already-resolved selection, and report what was not reached.

## Flag workflow through ui-ux-grill-me

Use `ui-ux-grill-me` as the presentation engine, one branch at a time, under the progressive rules above.

1. Group the user-specified scope into decision branches with one primary axis each, order them by dependency level, and keep the current interface as the baseline option in each branch.
2. Start the read-only audit first so evidence exists, but do not wait for it to finish. Begin presenting the first branch whose evidence is complete.
3. For each ready branch, invoke `ui-ux-grill-me`'s branch workflow with a narrow brief: the affected surface and route, the observed issue, the exact evidence paths, the repository's design system and tokens, the constraints the audit established, the inherited resolved decisions, the deferral conditions and the closure criteria for that branch.
4. Every presented option must show the current UI, state the observed issue plainly, and explain what the alternative changes and what it costs, grounded in existing tokens, components and real states. No invented art direction, no unlabeled mock metrics.
5. Share the URL returned by `SubmitQuestion` immediately, then call `WaitForAnswer` for that branch with a stable question ID. Block that branch on the human answer and resume on the watcher wake. A timeout or monitor exit is not a selection.
6. Keep the branch's provenance: question ID, the actual returned response path, the trusted variant mapping and the selection evidence. The user chooses, modifies or skips. A comments-only rejection is rework, not approval.
7. Apply only resolved selections, one decision at a time, within the same owned files, as each branch resolves. Conflicting selections become an explicit follow-up branch rather than a silent merge.
8. Interview tooling (`pi-decisions`, `pi-loop-monitor`, browser automation, Herdr Core when workers are used) that is missing or unready blocks the branches that need it. Report it; never substitute a chat question, a fake page or a preselected answer, and never let it stall branches that do not depend on it.

## Auto-fix execution

- Make the edit inside the same implement ownership. Reuse the shared component and tokens; follow the `ui-conventions` order of reuse, extend, add locally; apply `ui-copy` to every string touched.
- Preserve behavior, state ownership, focus, keyboard contracts, dismissal and accessibility semantics. A visual fix that changes behavior is a regression, not a fix.
- Prefer editing the owning component, then adding a variant to it, then adding a local control. Never fork a component so one screen can look right.
- Keep the diff minimal. Do not refactor, reformat, rename, reorganize or "also fix" findings outside the declared scope.
- If the correct fix expands beyond the owned surface, stop and reclassify it as flag mode or a blocker with the evidence. Widening a change silently is the failure this workflow exists to prevent.
- Run the repository's existing checks for the touched scope once — typecheck, lint, build or format as declared by the repository. They are necessary and never sufficient on their own.

## Diagnosis and blockers

A failed fix or recheck is a diagnosis checkpoint, not a reason to guess. Inspect the actual error and evidence, form one hypothesis, apply the smallest correction addressing it, then re-verify. Do not repeat an unchanged attempt, do not mark a check PASS from a build result, and do not build recovery machinery for a one-off failure.

When the next step needs a surface, account, tool, runtime state or user decision that is unavailable, mark the task blocked with that exact dependency and what would unblock it. Report source-level completion separately from the live verification that is missing, and say once that it is missing instead of probing repeatedly.

## Runtime recheck

- The recheck is read-only `ui-ux-testing` work. Its owner must not be the fix author, and a fix never verifies itself.
- Repeat the original failing cases at the same route, viewport, theme, data state and interaction state, then add the adjacent keyboard, responsive and theme states and every consumer of a shared component that changed.
- Confirm the functional flow the fixes touched still behaves. A UI correction must not change what the application does.
- Static checks never replace the runtime recheck. If a live state is unavailable, mark it **BLOCKED** or **NOT RUN** with the exact missing dependency.
- A finding closes only when the runtime recheck reproduces the corrected state. Otherwise keep it open with its evidence.

## Report

For each finding: id, severity, fix class, disposition (`fixed`, `flagged` with the decision and selected option, `deferred`, `skipped`, `out of scope`, `not reproduced`), before/after evidence paths, files changed, recheck result and any blocker.

Record the branch log as it happens instead of reconstructing it at the end: branch id, question id and shared URL, the evidence set that made it ready, the response path, the resolution, and the fix it authorized. The final report reconciles that log with the audit's findings and coverage, including branches still pending or blocked when work stopped.

Also record: the entry path and mode used, the authorized surface, the functional-verification state (or that there was no implementation to verify), checks run, and the remaining limits. Lead with complete or blocked. Never claim a fix is done because the code changed or a build passed.

When the audit finds nothing in scope, report **no issues found in the tested scope** and stop. Do not invent UI work to justify the phase.

## Non-goals

- Subjective redesign, unsolicited polish, restyling, density or typography preferences, and "while we are here" improvements. These need a user decision, not an auto-fix.
- Design-system migration, cross-app or cross-directory consolidation, component renames, new wrapper layers, and new UI dependencies.
- Turning a non-UI task into a UI task, or reopening an earlier audit whose scope this request did not continue.
- Acting as the auditor or as the independent recheck owner.
- Any permission the implementation task did not already have.

## Coordination and delegation

Follow global `implement` for Work/Todo tracking, artifact paths, ownership declarations and verification. Keep the audit, each decision branch, the fix and the recheck as separately owned steps when more than one agent is involved; a worker's completion signal is not an acceptance gate.

Independent, dependency-free decision branches may be owned by different agents running concurrently, each with its own canonical task directory, its own question ID and its own browser page, following `ui-ux-grill-me`'s branch-owner assignment. The parent keeps the branch DAG, reads each complete result against the original evidence, and accepts only verified resolutions. A branch owner never presents another branch's decision, waits on a sibling's answer, or holds back a branch that is already grounded.

Read global `model-routing-policy` before launching workers. Audit and recheck workers keep that skill's `ui-ux-testing` session route; implementation and repair owners use its normal implementation or review defaults, never the audit route. Respect `no-arbitrary-limits` and the audit's own safety rules; delegation grants no additional permission.
