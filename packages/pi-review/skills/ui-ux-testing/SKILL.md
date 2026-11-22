---
name: ui-ux-testing
description: "UI/UX audit and authorized post-implementation disposition in one skill. Review mode is read-only: parallel subagents inspect workflows, overlays, responsive layout, spacing, accessibility, forms/search/navigation, themes, rendered contrast, outer-frame edge geometry, interface copy via ui-copy and cross-directory component reuse via ui-conventions, then report verified defects with reproduction, evidence, severity, suggested fixes and a fix class. After authorized implementation, fix-or-flag mode auto-fixes clear in-scope defects that contradict the repository's design system or presents user-specified decisions through ui-ux-grill-me as each branch becomes grounded while the audit continues. Every fix gets an independent runtime recheck. Use for UI/UX audits, visual regression checks, post-implementation verification, named UI reviews and screenshots showing defects. Review mode never edits production source; no fix occurs without implementation authorization or an explicit user selection."
compatibility: Requires authorized runtime UI access and browser or desktop automation for live evidence. Delegated audit, branch, repair and recheck owners require Herdr Core and continuous monitoring; a dedicated visible app tab is needed only when presentation is explicitly requested. Flag mode additionally requires ui-ux-grill-me with pi-decisions and pi-loop-monitor. Fresh rendered-contrast and outer-frame edge evidence uses the bundled references.
---

# UI/UX Testing

Find what breaks when someone actually uses the interface, then report each verified defect with exact reproduction and evidence—not just the first render. In review mode this skill never edits production source. In fix-or-flag mode it may dispose of findings only inside authorization inherited from the implementation task or an explicit user selection. Before replying, follow `talk-human`. Follow `no-unit-tests`; UI testing never authorizes unit tests. Follow `no-arbitrary-limits` for any repair.

## Modes and authorization

Declare the mode, authorized surface and functional-verification state in the Work/Todo record before the audit starts; the audit needs that declaration.

- **Review (default).** Standalone audits, read-only post-implementation reviews, caller-requested rechecks and named UI surface reviews start here. Inspect, capture evidence, assign a fix class and report. Do not edit production source, implement findings, commit, deploy or delegate implementation. A named surface review may use flag decisions, but an explicit user selection is the only authorization for the resulting scoped fix.
- **Fix-or-flag (post-implementation only).** Use this mode only after `implement` changed a user-visible UI and completed functional verification. Run the same read-only audit, then auto-fix clear in-scope defects or flag decisions through `ui-ux-grill-me`. A repair inherits the implementation task's authorization, files, checks and permission prompts; this skill grants nothing beyond them. Every fix is rechecked at runtime by an owner independent of the fix author.
- **Flag decisions.** Use them for user-specified scopes, `needs-user-decision` findings and any fix that would change direction, hierarchy, navigation, density, copy intent, a shared component or a dependency. Present each grounded branch as soon as its evidence closes, share the returned decision URL immediately, and keep auditing other lanes. Silence, chat approval or an "obvious" option is not a selection.

Use `ui-ux-grill-me` directly for open-ended design exploration; this skill is not a route for starting a broad UI project. Invoke fix-or-flag mode explicitly from the `implement` hand-off or from a review request that already names an authorized repair. Do not attach it to unrelated implementation work.

```text
implementation (implement) → functional verification (implement)
  → read-only audit (this skill, either mode)
      ├→ review report → caller fixes through implement → optional read-only recheck
      └→ authorized fix-or-flag mode
           ├→ auto-fix clear defects → independent read-only recheck → disposition report
           └→ grounded flag decisions → user selection → scoped fix
                                      → independent read-only recheck → disposition report
```

## Where this fits

- `implement` owns implementation, functional verification, integration and the final claim. After a UI-changing change it hands the surface here in fix-or-flag mode unless the user opted out or asked for a read-only review.
- This skill owns inspection, evidence, the coverage verdict, the per-finding fix class and, only in authorized fix-or-flag mode, disposition of those findings. The audit lane stays read-only in both modes; a fix is a separately owned step.
- `ui-ux-grill-me` owns the flag-mode interview and recorded decisions. A decision authorizes exactly its own branch on the named surface.
- The independent recheck uses this skill's read-only evidence method. Its owner must not be the fix author.
- A progressive caller changes nothing in the audit. Hand each lane's verified findings to disposition as its evidence can ground a decision, and keep auditing the remaining lanes. Synthesis and the aggregate report never gate the first decision.
- Standalone audits stay valid. When no authorized repair owner exists, the report is the deliverable and the caller decides everything else.

## Scope and safety

- Read repository instructions, relevant flow docs, design contracts and the reported screenshot first.
- Identify the target URL/build, affected workflow, supported devices/themes and allowed actions.
- A request to audit authorizes non-mutating UI inspection, navigation, opening overlays and temporary search input. Check for autosave before typing into other fields.
- Do not submit forms, send messages, make paid calls, enable microphone/camera, upload files, delete data or change persistent settings without authorization.
- Do not bypass authentication. Stop for passwords, MFA, permission prompts or unclear account choice. Do not extract cookies or credentials.
- Do not install browsers/dependencies, restart services, rebuild live assets or deploy without the required authority. Preserve unrelated work and user-owned resources.
- UI evidence never outranks functional verification. When the implementation's functional verification is blocked, incomplete or **NOT RUN**, behavior-dependent cases stay **BLOCKED**. Read-only evidence may still be collected, but the repair phase stops; a spinner that never clears is first a verification blocker, not a layout problem.
- Judge against what the repository already owns. Read global `ui-conventions` before calling a control or token wrong: the design system, wrapper layer and existing components define correctness, not this skill's taste. Judge interface text with global `ui-copy`, which protects warnings, limits, error text and accessibility instructions from casual trimming.
- Review mode is authorization to audit, not to fix. Fix-or-flag mode adds no permission beyond the implementation task or an explicit user selection. Touches stay inside the changed or named surface; anything else remains an unowned observation. Keep captures, reports and dispositions inside the task artifact directory, and never rewrite the auditor's report as if the auditor had made the fix.
- One owner per file at a time. If the smallest correct fix needs a file another owner holds, or a shared component nobody assigned, the finding becomes a flagged decision or a blocker—not a quiet edit.

## Coordination and tools

Use existing Work/Todo records and keep them current when available. Never change tracking during `/ask`. Use monitors for background commands; do not create polling loops for an ordinary audit.

Read `browser-use` for browser operation. Prefer an isolated local browser with already-installed tools; an installed Playwright runtime is acceptable when the browser harness cannot connect. Do not silently switch to a paid remote browser. For native apps, read `computer-use` and use its verified screenshot/accessibility workflow.

Close only owned browsers/contexts in `finally`. Never close a personal tab or another worker's service. Keep waits bounded; after a failed wait inspect the page before one additional bounded attempt.

Follow global `implement` for canonical task ownership. Keep aggregate reports inside the parent's task directory and each worker's report/screenshots inside its own canonical task directory, nested below the exact supplied parent task directory using that worker's real session/Work/Task IDs. Reuse caller tracking for the same assignment; standalone work establishes its own tracked owner first. Link exact original evidence paths from the aggregate report; never reconstruct feature or lane folders. Protect private data in captures and do not retain raw sessions in memory.

## Validate the testing method before expanding coverage

- Follow `browser-use`'s simple testing loop: start with direct actions or short inline batches, prove each step, then automate only stable repeated sequences. Do not create a long custom harness before reproducing one real case.
- Establish a positive control within existing authorization before declaring input or observation broken. Confirm the actual page/frame and visible value/result; validate any custom observer before treating its silence as product evidence. Do not change application state, caret or model internals merely to satisfy a test.
- Keep related steps in one owned browser/page within supported lifetimes. Avoid unnecessary account/profile recreation or one launcher invocation per screenshot; retain useful failure context until collected, then clean up only owned resources.
- After two failures at the same step, stop cycling through variants. Inspect whether the tool, test assumptions or application failed, and choose one evidence-backed next step. No new evidence means report the limitation, not another blind retry or a generic permission question.
- For persistence cases, distinguish value entry, application acknowledgement, completed server save/drain and fresh reopen. Check each boundary rather than inferring the full workflow from an intermediate success.
- Separate application defects from test/tool failures in the coverage report. Mark a check **TOOLING FAILURE; application NOT VERIFIED** when its observer, selector or harness is faulty; preserve its original evidence and do not present it as an application defect or a pass. A genuine reproduced application defect remains FAIL.
- Complete this preflight before fan-out. Give auditors the validated interaction method and known tool limits so they do not independently repeat the same failed setup.

## Parallel auditors: maximize useful coverage

Assign a different dedicated subagent to each applicable area below; do not bundle unrelated areas into one generalist audit. Run independent areas concurrently to speed up coverage within actual browser/tool capacity and explicit user budgets. If capacity is limited, schedule distinct area owners in waves rather than silently merging responsibilities. Record owners, dependencies, constraints and any area omitted as not applicable or blocked. Expand a busy area across disjoint routes when useful; do not duplicate cases or invent irrelevant work.

Complete baseline/access preflight and the coverage matrix before dispatch. Verify the prerequisites each case actually needs: saved disposable data, the required account role, an alternate theme, real browser zoom or device emulation, a mobile keyboard, and a reachable non-mutating modal or route. If a prerequisite cannot be verified safely, mark only the dependent case IDs `BLOCKED` or `NOT RUN` before dispatch and give the affected lane source-only or unaffected cases instead; do not fan out a browser lane whose acceptance criteria depend on missing state. Avoid spawning agents just to rediscover a known authentication or tooling blocker. While runtime access is blocked, independent source inspection and coverage review may proceed, but cannot count as live UI passes.

Select global `herdr` for Core-hosted Pi agents and read it before launching. Verify the real HC_TERMINAL_ID parent and app space; do not require HERDR_ENV or the old TUI CLI. Read `model-routing-policy` before launching workers: audit, consistency, source-investigation, synthesis and independent recheck workers use its `ui-ux-testing` audit route; implementation and repair owners use normal implementation or review defaults, and flag interviews keep the `ui-ux-grill-me` route. Verify image support for screenshot reviewers. If Core, the app, required models or continuous monitoring are unavailable, report the precise tooling blocker; do not silently substitute a single-agent audit.

### Critical workflows agent

Assign a dedicated workflow auditor for primary actions, button versus keyboard submission, disabled/busy explanations and safe failure recovery. Observe sending, paid or destructive workflows only within explicit authorization.

### Overlay visibility agent

Assign a different overlay auditor for dropdowns, popovers, dialogs, tooltips and inspectors. Check clipping, occlusion, edge placement, scroll reachability, dismissal and reopen in the integrated layout.

### Responsive layout agent

Assign a different layout auditor for narrow panes/screens, short windows, resizing, zoom/reflow, overflow and sticky/fixed siblings. Check both viewport bounds and actual pane bounds. For layouts with several collapsible or resizable panels, also own the progressive multi-panel case: record the available inline size of the panel container, walk each transition in both directions, and keep the primary workspace and hidden-panel affordances reachable. If test data or authorization prevents reaching that surface, report it as BLOCKED or NOT RUN with the missing dependency instead of treating single-pane passes as coverage.

### Keyboard and accessibility agent

Assign a different accessibility auditor for Tab/Shift+Tab order, activation, visible focus, focus return, Escape, labels, semantic roles and modal containment. Do not claim accessibility certification from automated checks.

### Forms, search and navigation agent

Assign a different interaction auditor for typing, clear controls, no-results, validation, loading/error states, Back/Forward and active navigation. Compare search behavior across relevant routes without unauthorized submissions or autosaves. For navigation or auth links in scope, report app-owned and provider-rendered links separately with their expected destination, origin and rendered mode, plus the sign-in to sign-up flow and back, and relevant deep links, without submitting credentials; cover sign-out or account switch only when that session is already authorized.

### Themes and content agent

Assign a different visual-content auditor for supported palettes, contrast, outer-frame geometry, density, typography, long labels, wrapping and empty/loading/error states. Compare against approved visual contracts, not an invented redesign. Require this auditor to follow [the rendered contrast protocol](references/contrast.md); palette-token math alone is not a rendered contrast PASS. For shell or theme changes, also require [the outer-frame edge protocol](references/frame-geometry.md), including an explicit bottom-edge and corner case.

### Component reuse and visual consistency agent

Always assign a dedicated consistency auditor for changed UI controls. Start from global `ui-conventions` to locate the design system, tokens, wrapper layer and shared package, then inventory existing components and equivalent uses across screens and directories, including components outside `components/ui/`. Compare Files versus Settings dropdowns and Files versus Chats search fields when present, plus buttons, tabs, notices and menus. Flag raw controls, copied markup, divergent icons, spacing, borders, typography and interaction states that bypass the shared component without a documented requirement. Record each location, canonical component, evidence and smallest reuse fix; distinguish justified variants. Recommend that validated fixes reuse the common component rather than copy its CSS or create another lookalike. Report shared-file impact and affected callers; the caller assigns the implementation owner. Recheck consistency at every affected use only when the caller requests a read-only verification.

### Source investigation agent

Assign a different read-only source investigator to trace observed symptoms to owning components, CSS and callers. Check lifecycle and dependency boundaries; label hypotheses and source-only findings separately from reproduced browser failures.

### Independent findings review agent

Assign a different synthesis reviewer once area reports are ready. Reconcile duplicate causes, challenge unsupported passes/findings, check missing coverage and scope, and ensure component-reuse findings have explicit dispositions. This reviewer does not substitute for the original area audits.

### Recheck verification agent

When the caller explicitly asks for a read-only recheck, or when fix-or-flag mode must recheck a completed fix, assign a verification subagent independent of the fix author, and never let an auto-fix or flag-mode change verify itself. Repeat the original failing cases and adjacent keyboard, responsive and theme states; recheck all consumers of changed shared components; confirm the functional flow the fixes touched still behaves. Keep unavailable live checks blocked rather than replacing them with fixture/static passes. The recheck reports evidence only; the caller still owns fixes, integration and final verification.

Keep area owners distinct for the audit pass. Run ready independent work in parallel; order synthesis and shared-state checks instead of racing them. Rechecks requested by the caller come after fixes are integrated.

### Dispatch and isolation contract

1. The parent creates one Todo per lane and a final report Todo under the audit Work, and owns the aggregate matrix with unique case IDs. Give each worker its case IDs, target build/routes, viewports/states, allowed/prohibited actions, browser ownership and report paths. All workers are read-only for application source during the audit and do not edit the parent's aggregate report.
2. Follow `herdr`: explicit verified model settings, actual terminalId handles, and a continuous MonitorCreate with hcTerminalId, timeout:0 and onSignal. Workers are Core-only by default; when the user or this audit requires visible workers, pass present:true and verify the dedicated task-named app tab as well, so tabId is present only for a presented worker. Confirm native Pi input readiness and MonitorList's Core subscription ready receipt before prompting. No hidden-worker substitute when presentation was requested, one-shot waits or unmonitored dispatch.
3. Give each browser auditor an exclusive page and preferably a separate browser context. Tabs alone do not isolate storage/theme synchronization or shared account/server state. Allocate authorized isolated test state, or serialize conflicting actions. Do not extract cookies or clone credentials to manufacture isolation.
4. Never have multiple agents drive the same page, focused desktop or user browser simultaneously. A shared native desktop gets one UI owner at a time; other agents may inspect source/evidence in parallel. Report the live-coverage limit rather than pretending parallel screenshots exercised separate sessions.
5. Each worker writes `<workerTaskDir>/report.md` and `<workerTaskDir>/screenshots/` inside its own canonical nested task directory from global `implement`. Pass the exact parent task directory; require the worker's real local session/Work/Task IDs and returned artifact root. Lane names are metadata, not directory ownership keys. Require exact case results, reproduction steps, screenshots, environment, blockers and action limits. Workers inherit all safety gates; delegation grants no additional permission. No recursive subagents unless the parent explicitly authorizes them.
6. Keep each owned monitor across working/blocked/idle/done and follow-up states. Inspect real worker status and the complete result, not status signals alone. Resolve blockers or reassign safe cases; do not recreate subscriptions for stale signals or monitor unrelated sibling parents.
7. The parent reads every complete worker report, opens finding screenshots, reconciles unique case IDs and deduplicates findings without hiding different triggers. Reproduce material defects when authorized; otherwise label them worker-reproduced or not independently reproduced. Source-only and fixture checks remain separate from live results. A worker's done signal is not an acceptance gate.
8. Run the synthesis lane once evidence is ready, resolve conflicting findings and publish the audit baseline with per-lane coverage. Immediately after writing the aggregate artifact, verify the exact canonical path with `test -f <path>` and compare the recorded case IDs against the assigned matrix before handoff. A write success response alone does not prove the artifact landed in the parent's task directory or that every case row is present; copy or correct it before reporting completion. Stop at the report in review mode. In fix-or-flag mode, hand verified findings to disposition as they land; synthesis still reconciles the aggregate baseline and re-authorizes nothing. The owner decides which findings are in scope and owns fixes and further delegation; this skill does not implement them from the audit lane. Retire or retask completed roles according to model-routing policy. Close only owned monitors/tabs/contexts after their verified work and any required read-only rechecks.

## 1. Establish the real baseline

1. Reproduce the reported path with actual controls in the current application. Capture the initial full viewport, then the opened/failing state.
2. Record URL/route, source/build identity when available, browser/version, viewport in CSS pixels, device scale factor, zoom, theme, pane sizes, scroll position and relevant data state. Do not dump environment values.
3. Use the actual page layout: the real ancestors, footer/composer, sidebar, sibling overlays, fonts, scroll containers and stacking contexts matter.
4. If access is blocked, report **BLOCKED**. A screenshot-only diagnosis is a hypothesis. An anonymous fixture may supplement investigation but cannot pass a live integration gate.
5. Do not inject CSS, force-click, hide surrounding components or scroll a target into view before capturing the natural failure. Browser automation may auto-scroll; record when it does.

## 2. Write a bounded coverage matrix

List each distinct trigger/state before running checks. Do not count two buttons as covered because they look alike; Context and Cost can open different panels.

| Axis | Minimum relevant coverage |
| --- | --- |
| Interaction | Closed, opened by pointer, opened by keyboard, dismissed, reopened; each distinct trigger |
| Layout | Current layout, narrowest supported pane, smallest supported viewport, short-height desktop |
| Available width | Record the viewport and the actual app/pane inline size. When reachable, include a case where available width changes without changing the outer viewport, such as docked developer tools, a side panel or a resized container, and label the method used. |
| Multi-panel progression | For layouts with more than one collapsible or resizable panel, cover every visible transition from wide to narrow and back: which panel changes, whether the primary workspace stays reachable under the repository's existing contract, whether hidden-panel controls are reachable and truthful, and whether focus and required content remain visible. Mark the case BLOCKED or NOT RUN with the missing data or access when the route cannot be opened. |
| Viewport | Actual user size; if unspecified, add 1280×800, 1280×600 and 360×800 CSS pixels, labeling assumptions |
| Scroll | Top and bottom; middle when sticky/fixed elements or long content can affect placement |
| Content | Empty/short and realistically long labels/details; loading/error/disabled states when safely available |
| Design system | Existing component, token and wrapper for every changed control; equivalent uses in other directories; justified variants |
| Spacing | Gaps, padding and alignment against the repository's spacing scale and the equivalent shared component |
| Copy | Labels, hints, empty and error states checked with `ui-copy`; required warnings, limits and formats still present |
| Accessibility | Tab/Shift+Tab, activation, Escape, focus return, 200% browser zoom or equivalent reflow check |
| Theme | Current and supported light/dark alternatives; for each in-scope text/icon role, record its rendered pair against its own surface in each reachable state, including inherited or overridden tokens (see [rendered contrast protocol](references/contrast.md)) |
| Outer frame | For shell/theme changes, all four outer edges and corners, especially the bottom strip under a rail or pane; capture a zoomed edge crop and label inherited geometry versus a user concern (see [outer-frame edge protocol](references/frame-geometry.md)) |

Prioritize reported failures and shared overlays, then adjacent controls. State omissions explicitly; do not invent every possible state or run an unbounded Cartesian product. Device scale factor is not browser zoom; label emulations and unavailable mobile-keyboard checks honestly.

## 3. Check every opened surface in context

Read [the visibility protocol](references/visibility.md) before checking clipping, overflow or layered surfaces.

For popovers, menus, tooltips, dialogs, dropdowns, inspectors and expanded panels:

- Inspect the whole surface in a full-viewport screenshot, not only a cropped heading or its DOM presence.
- Check top/bottom/left/right edges against the visual viewport and intended pane. No text, action or close control may be silently cut off.
- Inspect overflow ancestors and stacking contexts. A high child z-index cannot escape a lower ancestor layer. Look for composers, sticky footers and sibling panels covering content.
- Verify title, representative middle content, final row/value, close control and primary actions are visible or genuinely reachable by the intended scrolling.
- Check pointer hit targets and keyboard reachability. A passing bounding rectangle, `isVisible()`, screenshot hash or successful force-click is not proof of visibility.
- Open near each relevant edge. Resize the viewport/pane and scroll the parent while open; confirm the overlay repositions, scrolls appropriately or deliberately dismisses.
- For long content, verify an intentional scroll container and that its final item can be reached. Scrolling the background must not masquerade as scrolling a modal.
- Check anchor relationship, overlap between simultaneous overlays, outside-click/Escape behavior and focus return. Modal focus stays inside; non-modal panels need not trap focus.

**Required regression example:** open Context and Cost separately above a chat composer at short height and a narrow pane. Verify the middle and bottom of each details panel are not behind the composer, even when the entire panel rectangle lies inside the viewport.

### Progressive multi-panel layout

For a workspace with several panels, do not let a fixed-viewport screenshot stand in for the width sequence. Record the container's available inline size alongside the viewport, then narrow and widen through each observed transition boundary. At each step check the primary workspace against the repository's existing contract, the reachability and state of controls for hidden panels, and the location of focus after a panel appears or disappears. Confirm content that must remain visible is not clipped by the remaining panels. If the container-width change or the multi-panel route cannot be reached with the available tooling, data or authorization, preserve the case as **BLOCKED** or **NOT RUN** with that exact dependency; do not report a viewport-only pass as multi-panel coverage.

## 4. Check spacing, shared components, copy and rendered paint

Spacing and consistency are defects only when they contradict something the repository already defines. Establish that contract first with global `ui-conventions`: the design-system package or token file, the wrapper layer, the shared primitive, and every existing use of the same control, including call sites outside `components/ui/` and in sibling apps or directories.

- Measure the real gaps, padding and alignment of the changed surface, then compare them with the equivalent shared component and the spacing scale or tokens. Report a mismatch only when both the measurement and the existing contract are recorded.
- Compare one control across screens: trigger, popover, menu item, button, tab, notice and empty state. Divergent borders, radii, icons, typography, hover/focus treatment or dismissal behavior, and hand-rolled markup that bypasses a shared component, are findings when they contradict the shared component's own contract; a documented variant is not.
- Record the canonical component and the smallest reuse-based correction instead of a restyle. Copying a component's CSS or adding a second lookalike is not a fix.
- Judge interface text with global `ui-copy`. Classify per claim, not per string, and verify a stated consequence in the source before calling a line filler. Warnings, limits, required formats, error text and screen-reader instructions stay unless replaced by something equally clear.
- Personal preference is not a defect. A deliberate density, brand treatment or justified variant belongs in the report as an observation, not a FAIL, unless it breaks the repository's own contract.

### Rendered contrast in context

Read [the rendered contrast protocol](references/contrast.md) before reporting any contrast PASS. Check each visible text run and functional icon against the surface it is actually painted on, not only the theme's token pairs:

- Record the live state, composited foreground and background colors, the rule or token that set each, and the resulting ratio or the precise reason it could not be measured. Include inherited color, child overrides, opacity, gradients and overlays; a muted token on a parent says nothing about a child icon inside a saturated button.
- Include the default view and each safely reachable state that changes the foreground or surface, such as hover, focus, selected, disabled, open, loading and error. Mark unobservable states **NOT RUN**; do not carry a PASS across states or surfaces.
- A contrast PASS covers only the enumerated rendered pairs and states. It is not accessibility certification and makes no guarantee about untested states, themes or zoom levels.

### Outer frame and edge geometry

Read [the outer-frame edge protocol](references/frame-geometry.md) for shell, theme or layout changes. A full-viewport capture can contain a missing bottom strip without the audit ever naming it:

- Add an explicit case for the top, right, bottom and left outer edges and their corners at the real viewport and pane sizes. Inspect a zoomed crop of the bottom-left and bottom-right corners, not just the panel center.
- Record whether every inset, seam and background band is authored by an existing shell contract, introduced by this change, or merely a user concern. Inherited documented geometry is an observation, not automatically a defect; a user request to remove it is a new visual-direction decision, not a silent auto-fix.
- If an edge cannot be observed or its contract cannot be established, mark the case **BLOCKED** or **NOT RUN** with the missing access and explicitly acknowledge it in the report. Do not let a passing contrast or overflow case stand in for outer-frame coverage.

## 5. Check everyday usability

- Search: click, type, clear, no-results, Escape and keyboard navigation; inspect unexpected rings, underlines, jumps or text clipping.
- Forms: labels, caret/focus discoverability, error text, disabled/busy distinction and stable geometry; do not submit without authorization.
- Chat keyboard contracts: where specified, Enter sends, Shift+Enter inserts a newline, and IME composition does not submit. Compare Enter with the Send button and inspect disabled reasons; actual sends still require authorization, including paid-model permission.
- Navigation: active state, Back/Forward, reachable actions and no accidental document-level horizontal scrolling. When the authorized scope includes navigation or authentication, follow app-owned links and links rendered by an SDK or identity provider separately, and verify the actual destination origin, path, hash and rendered mode rather than the visible label. Check the auth flows in both directions, such as sign-in to sign-up and back, plus relevant deep links and any `next`, return or callback value, and cover sign-out or account switch only when that session is already authorized. Stop at the credential prompt; do not fill or submit credentials or bypass authentication. Skip this check when the scope has no navigation or auth surface.
- Dense layouts: long names, wrapped text, scroll areas, fixed headers/footers, menus near viewport edges and controls at 200% zoom.
- Keyboard: logical order, visible focus consistent with approved styling, no focus hidden beneath overlays, correct Escape target and restored trigger focus.
- Feedback: loading/error/empty states are distinguishable; do not trigger billable or destructive work merely to generate a state.
- Record browser errors and relevant failed requests without copying tokens, private payloads or full logs. Automated accessibility findings supplement, not replace, visual inspection.

Do not replace a user-rejected decoration with another invented one. Preserve approved interaction and visual decisions unless explicitly changed.

## 6. Build the audit report

Create `report.md` with:

1. **Scope/environment:** target build and exact tested layouts/states; live page versus fixture evidence; worker/lane allocation and concurrency limits; mode, authorized surface and functional-verification state.
2. **Findings:** severity, affected control/route, reproducible steps, expected versus observed behavior, screenshot path, supporting measurements and the repository contract the behavior violates.
3. **Cause:** confirmed owning selector/component when source evidence establishes it; otherwise label the cause a hypothesis. Record the smallest scoped correction as a suggested fix; do not treat an unconfirmed cause as an implementation requirement.
4. **Fix class:** one per finding, from the vocabulary below. A finding without a fix class is an unfinished audit.
5. **Coverage:** one row per actual case with PASS/FAIL/BLOCKED/NOT RUN and linked evidence. A reproducible defect is FAIL, not BLOCKED. For contrast cases, include the rendered pair, ratio, state and source rule; label token-only calculations **source only**. For outer-frame cases, include the edge/corner, viewport and inherited-versus-new contract judgment. For multi-panel cases, include each transition, both directions and the measured available width. No silent skips or blanket "all UI passed" claims.
6. **Suggested next steps and limits:** each finding's suggested fix, affected owner/component and next step; recheck results only when a recheck was performed; unavailable auth/device/data/browser states; risky steps not attempted; and exact rechecks. Keep the original failing evidence intact.

### Fix classes for the repair handoff

The fix class is the auditor's judgment about authorization and evidence, not a restatement of severity. It tells the owner what a finding is allowed to become.

- **auto-fixable** — reproduced live; violates a contract the repository already owns (design-system component or token, `ui-conventions` interaction rule, `ui-copy` rule, accessibility requirement, clipping or overlap of content or controls, spacing that contradicts the shared component or scale); correctable inside the implementation's own surface with the smallest reuse-based change; no change to visual direction, hierarchy, navigation, copy intent, component API or dependency.
- **needs-user-decision** — subjective, or it changes visual direction, hierarchy or copy intent, introduces a pattern, component or dependency, or spans directories and shared components enough to be a consolidation decision.
- **out-of-scope** — real but outside the authorized surface or task; report it without proposing an unrequested change.
- **not-reproduced** — evidence did not establish a defect; keep it in the report as an observation with the missing state.

When in doubt, choose `needs-user-decision`. Misclassifying a taste change as `auto-fixable` is the failure this classification exists to prevent. Inherited outer-frame geometry that the current change did not introduce stays an observation or a user concern unless the repository contract says otherwise.

Severity follows user impact: blocked essential action or serious access failure is high; obscured recoverable content is medium; purely cosmetic issues are low. Explain the impact rather than guessing a priority from appearance alone.

Each finding needs its natural failing state. Screenshots plus reproduction steps are required; DOM measurements alone are insufficient. Include a wider context capture when a crop hides the occluding layer. Redact sensitive content without hiding the defect.

## 7. Stop at the report in review mode

Review mode's report is the final deliverable. It does not edit production source, implement findings, commit, deploy or delegate implementation.

1. Give the caller the report with each finding's reproduction, evidence, severity, fix class, affected component/owner, suggested fix and exact recheck steps. When a caller is running a progressive decision workflow, release verified per-lane findings as each lane closes instead of withholding everything until the aggregate report is assembled. Do not claim a fix or implementation status.
2. The caller decides which findings are in scope and owns fixes, their sequencing, implementation delegation and final verification through `implement`. An explicit user selection in a named review authorizes only its own scoped fix; that fix is a separate authorized step.
3. If the caller later asks for a read-only recheck, verify the integrated fixes against original failing states and adjacent cases, capture new evidence, and update the report with **recheck passed**, **recheck failed**, **still blocked**, or **not run**. Do not edit source or implement corrections.
4. If no actionable defects were found, report **no issues found in the tested scope** and do not invent changes.

Finish with what was tested, actual checks and rechecks, remaining findings and blockers, evidence paths and owned-resource cleanup. Do not claim accessibility certification or a pass solely because a fix built or lint passed.

## 8. Fix-or-flag mode

### Entry paths

1. **Post-implementation (auto-fix default).** An `implement` task changed a user-visible UI surface, functional verification is complete, and the user has not opted out or asked for read-only review. `implement` hands the changed surface here; the phase and mode are recorded as the hand-off starts, not before the implementation.
2. **Named UI review (flag only).** The user asks to review, improve or judge a specific UI surface with no implementation behind it. Start read-only, audit that surface, then open decision branches as evidence closes. Nothing changes before the user selects or authorizes it; a skip ends only its branch, and a stop ends the review.

This mode does not apply when the task touched no user-visible UI and the user asked for none, when a read-only audit or planning request named no surface to review, when a finding belongs to an earlier unrelated audit or an unauthorized surface, or when a change needs a design decision, new dependency, design-system migration or cross-directory consolidation. Those become reports, flags or blockers, never silent fixes.

### Required order

**Post-implementation path**

1. **Implementation** by `implement`, on the surface being reviewed.
2. **Functional verification** by `implement`, before any repair decision. This is a gate, not a formality. If it is blocked, incomplete or **NOT RUN**, the repair phase stops; behavior-dependent findings stay **BLOCKED** and must not be "fixed" by hiding the symptom.
3. **Read-only UI audit** through this skill, told the mode, authorized surface and functional-verification state. The baseline must be current runtime, not a stale capture or fixture.
4. **Disposition** of each finding from its fix class as evidence lands, not only after the whole audit is assembled. A finding that becomes a decision opens that branch immediately.
5. **Present every ready decision branch as soon as it is grounded** through `ui-ux-grill-me`, while remaining audit lanes continue. Do not make the user wait for synthesis or the final report to make the first choice.
6. **Fixes only as the mode authorizes**, per finding or per resolved branch, as those resolutions arrive.
7. **Read-only recheck** of every fix by an owner independent of the fix author.
8. **Disposition report** reconciling findings, branches, evidence, checks and limits.

**Named UI review path**

1. The user names the surface. Read project instructions, the design system and the current runtime state first.
2. **Read-only baseline audit** of that surface only. Behavior that cannot be safely observed stays an observation rather than a pass claim; nothing here authorizes a change.
3. **Present each decision branch as soon as its evidence is ready** through `ui-ux-grill-me`, while other lanes keep running. The first branch must not wait for synthesis or the final report.
4. **Fixes only from resolved selections or explicit authorization**, one decision at a time, inside files that surface owns and under normal permission rules. A resolved branch may be fixed while other branches are still audited or decided. Skipped, deferred and unselected items stay untouched.
5. **Read-only recheck** of each changed state at runtime as its fix lands, then a report that reconciles every branch.

Both paths end at the report; neither may open a broader UI scope than the one named.

### Auto-fix conditions

A finding may be auto-fixed only when **all** of these hold:

- it was reproduced live in the current runtime; for a contrast finding, the reproduction identifies the rendered foreground and its own painted surface, not only a theme token pair (see [the rendered contrast protocol](references/contrast.md)); for a shell or theme frame finding, the edge/corner and its contract are explicit (see [the outer-frame edge protocol](references/frame-geometry.md));
- it violates a contract the repository already owns — a shared design-system component or token, a `ui-conventions` interaction rule, a `ui-copy` rule, an accessibility requirement, real clipping or overlap of content or controls, or spacing that contradicts the adopted scale or equivalent shared component;
- it is localized to the authorized surface and files this task already owns;
- it requires **no design decision**: no change to visual direction, hierarchy, navigation, information architecture, density, copy intent, component API or dependency;
- the smallest fix reuses or extends the existing component, tokens and copy rules rather than restyling, copying markup or adding a lookalike;
- the fix is verifiable by a repeatable runtime case at the same route, viewport, theme and data state.

If any condition fails, it is not an auto-fix. Choose flag mode or report it.

### Flag mode

Use flag mode when:

- the user specified a UI scope to change, improve or evaluate beyond a clear defect, including a named UI surface reviewed with no prior implementation;
- the audit classified a finding **needs-user-decision**;
- a fix would change direction, hierarchy, navigation, density, layout structure or copy intent, or introduce a pattern, component, dependency or variant;
- the fix spans directories or shared components enough to be a consolidation decision;
- the repository's written rule and its current code disagree and choosing a side is an architecture or dependency decision;
- findings conflict, or the audit could not reproduce the state it was asked about;
- functional verification is blocked for the behavior a finding depends on.

Flag mode is never satisfied by asking in chat, picking the "obvious" option for the user, implementing the recommended variant as a default, or treating silence as consent.

### Present each decision as soon as its branch is ready

Progressive presentation is the default for flag mode, not an opt-in variation. The user must not wait for an entire audit, synthesis pass or final report before seeing the first grounded decision.

1. **Split the authorized scope into decision branches**, one primary axis each, from the audit's coverage matrix and observed findings. Shared foundations — layout, navigation, design tokens, the component and interaction model — come first; independent branches follow.
2. **Judge readiness by evidence, not report status.** A branch is ready when it has everything a decision page needs: the current state captured live as a screenshot at the real route, viewport, theme and data state and compared at matching dimensions; the issue reproduced or explicitly labelled unverified; grounded alternatives that reuse existing tokens and components; the repository contract each option is judged against; and every dependency verified resolved.
3. **Present a ready branch immediately** through the `ui-ux-grill-me` branch workflow, even while other lanes are still running, reporting or blocked. Share the URL `SubmitQuestion` returned as soon as that submission succeeds, then call `WaitForAnswer` for the branch.
4. **Keep the read-only audit running concurrently.** Independent lanes continue inspecting the rest of the surface. Give each lane and branch owner its own page and, where storage or theme state is shared, its own browser context; never let two owners drive the same page or focused desktop at once, and inherit the audit safety rules unchanged. An unverified lane keeps its findings out of decision pages; it never holds back another grounded branch.
5. **Keep one open question per branch owner, not one globally.** Independent, dependency-free branches may have concurrent open questions in separate pages. Respect `ui-ux-grill-me`'s DAG and level rules: a branch whose input is another branch's choice waits for that decision, and foundation levels integrate before dependent levels open.
6. **Apply a resolved branch while the rest continues.** That branch's selection authorizes exactly its own scoped fix. Do not delay a resolved branch until every branch resolves, and do not fix a branch with no decision yet.
7. **Reconcile late evidence honestly.** When later evidence contradicts an already-presented option, or the state it depended on changed, reopen that branch with corrected evidence and a fresh question ID. Never rewrite or silently reinterpret what the user already saw under the same question, and never keep a decided branch invalidated by new evidence without saying so.
8. **Keep a blocked branch local.** A branch whose evidence is blocked, whose tooling is unready or whose dependency is undecided is marked blocked on its own. Other ready branches keep presenting and resolving; the blocked branch reports its exact dependency and what would unblock it.

The final report still closes the workflow and reconciles every branch, including those still pending when work stopped. Presentation order is evidence-driven: do not hold a grounded branch back for the report, and do not present a branch early to keep the workflow moving.

### Skip, defer and stop

- **Skip** applies to one branch. That decision is not a requirement, is never implemented later "to finish the job", and the remaining branches continue.
- **Defer** keeps a branch unselected with its revisiting condition. Dependents that required it are re-scoped or deferred too, never guessed.
- **Stop** ends the whole review. Preserve every branch's evidence and every resolved selection, and report what was not reached.

### Flag workflow through ui-ux-grill-me

Use `ui-ux-grill-me` as the presentation engine, one branch at a time, under the progressive rules above.

1. Group the user-specified scope into decision branches with one primary axis each, order them by dependency level, and keep the current interface as the baseline option in each branch.
2. Start the read-only audit first so evidence exists, but do not wait for it to finish. Begin presenting the first branch whose evidence is complete.
3. For each ready branch, invoke `ui-ux-grill-me`'s branch workflow with a narrow brief: the affected surface and route, observed issue, exact evidence paths, design system and tokens, constraints the audit established, inherited resolved decisions, deferral conditions and closure criteria for that branch.
4. Every presented option must show the current UI, state the observed issue plainly, and explain what the alternative changes and what it costs, grounded in existing tokens, components and real states. No invented art direction, no unlabeled mock metrics.
5. Share the URL returned by `SubmitQuestion` immediately, then call `WaitForAnswer` for that branch with a stable question ID. Block that branch on the human answer and resume on the watcher wake. A timeout or monitor exit is not a selection.
6. Keep the branch's provenance: question ID, actual response path, trusted variant mapping and selection evidence. The user chooses, modifies or skips. A comments-only rejection is rework, not approval.
7. Apply only resolved selections, one decision at a time, within the same owned files, as each branch resolves. Conflicting selections become an explicit follow-up branch rather than a silent merge.
8. Interview tooling (`pi-decisions`, `pi-loop-monitor`, browser automation, Herdr Core when workers are used) that is missing or unready blocks branches that need it. Report it; never substitute a chat question, fake page or preselected answer, and never let it stall branches that do not depend on it.

### Auto-fix execution

- Make the edit inside the same `implement` ownership. Reuse the shared component and tokens; follow the `ui-conventions` order of reuse, extend, add locally; apply `ui-copy` to every string touched.
- Preserve behavior, state ownership, focus, keyboard contracts, dismissal and accessibility semantics. A visual fix that changes behavior is a regression, not a fix.
- Prefer editing the owning component, then adding a variant to it, then adding a local control. Never fork a component so one screen can look right.
- Keep the diff minimal. Do not refactor, reformat, rename, reorganize or "also fix" findings outside the declared scope.
- If the correct fix expands beyond the owned surface, stop and reclassify it as flag mode or a blocker with the evidence. Widening a change silently is the failure this workflow exists to prevent.
- Run the repository's existing checks for the touched scope once — typecheck, lint, build or format as declared by the repository. They are necessary and never sufficient on their own.

### Diagnosis and blockers

A failed fix or recheck is a diagnosis checkpoint, not a reason to guess. Inspect the actual error and evidence, form one hypothesis, apply the smallest correction addressing it, then re-verify. Do not repeat an unchanged attempt, do not mark a check PASS from a build result, and do not build recovery machinery for a one-off failure.

When the next step needs a surface, account, tool, runtime state or user decision that is unavailable, mark the task blocked with that exact dependency and what would unblock it. Report source-level completion separately from missing live verification, and say once that it is missing instead of probing repeatedly.

### Runtime recheck

- The recheck is read-only work in this skill. Its owner must not be the fix author, and a fix never verifies itself.
- Repeat the original failing cases at the same route, viewport, theme, data state and interaction state, then add adjacent keyboard, responsive and theme states and every consumer of a shared component that changed.
- When a fix touches text, icons, color, opacity or inherited tokens, recheck the rendered foreground against its own surface for affected roles and states. Use [the rendered contrast protocol](references/contrast.md); a token computation or passing build is not a contrast recheck.
- For shell or theme changes, recheck the same outer edges and corners with the zoomed crops from the original failure. Use [the outer-frame edge protocol](references/frame-geometry.md); a passing center crop or overflow measurement is not an edge recheck.
- Confirm the functional flow the fixes touched still behaves. A UI correction must not change what the application does.
- Static checks never replace the runtime recheck. If a live state is unavailable, mark it **BLOCKED** or **NOT RUN** with the exact missing dependency.
- A finding closes only when the runtime recheck reproduces the corrected state. Otherwise keep it open with its evidence.

### Disposition report

For each finding record: id, severity, fix class, disposition (`fixed`, `flagged` with decision and selected option, `deferred`, `skipped`, `out of scope`, `not reproduced`), before/after evidence paths, files changed, recheck result and any blocker. For contrast fixes, record the rechecked rendered pair and state; for frame fixes, record the rechecked edge/corner and contract. Do not claim broader accessibility or design approval than the cases actually observed.

Record the branch log as it happens instead of reconstructing it at the end: branch id, question id and shared URL, evidence set that made it ready, response path, resolution and authorized fix. The final report reconciles that log with the audit findings and coverage, including branches still pending or blocked when work stopped.

Also record the entry path and mode, authorized surface, functional-verification state (or that there was no implementation to verify), checks run and remaining limits. Lead with complete or blocked. Never claim a fix is done because the code changed or a build passed.

When the audit finds nothing in scope, report **no issues found in the tested scope** and stop. Do not invent UI work to justify the phase.

## Non-goals

- Subjective redesign, unsolicited polish, restyling, density or typography preferences, and "while we are here" improvements. These need a user decision, not an auto-fix.
- Design-system migration, cross-app or cross-directory consolidation, component renames, new wrapper layers and new UI dependencies.
- Turning a non-UI task into a UI task, or reopening an earlier audit whose scope this request did not continue.
- Acting as the audit or independent recheck owner for a fix the same actor made.
- Any permission the implementation task or explicit user selection did not already grant.

## Coordination and delegation

Follow global `implement` for Work/Todo tracking, artifact paths, ownership declarations and verification. Keep the audit, each decision branch, the fix and the recheck as separately owned steps when more than one agent is involved; a worker's completion signal is not an acceptance gate.

Independent, dependency-free decision branches may be owned by different agents running concurrently, each with its own canonical task directory, question ID and browser page, following `ui-ux-grill-me`'s branch-owner assignment. The parent keeps the branch DAG, reads each complete result against original evidence, and accepts only verified resolutions. A branch owner never presents another branch's decision, waits on a sibling's answer, or holds back a branch that is already grounded.

Read global `model-routing-policy` before launching workers. Audit and independent recheck workers keep its `ui-ux-testing` audit route; implementation and repair owners use normal implementation or review defaults, never the audit route; flag interview workers keep the `ui-ux-grill-me` route; workers actually executing browser or computer use keep that execution route. Respect `no-arbitrary-limits` and the audit safety rules; delegation grants no additional permission.
