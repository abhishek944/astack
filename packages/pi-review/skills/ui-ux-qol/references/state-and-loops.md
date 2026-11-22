# State and recurring operation

## Dedupe ledger

The package owns one ledger per target repository:

```text
<repository-root>/var/pi-review/ui-ux-qol/state.json
```

This is runtime state, not an agent task artifact. Evidence, screenshots, and reports still belong under the canonical `implement` owner task directory.

The ledger is a JSON object keyed by target key. Keep only non-sensitive data:

```json
{
  "version": 1,
  "targets": {
    "<targetKey>": {
      "surface": "stable route or window name",
      "lastObservedAt": "ISO timestamp",
      "candidates": {
        "<candidateId>": {
          "axis": "one design or interaction axis",
          "evidenceFingerprint": "sha256 of the evidence set and source state",
          "evidencePath": "owner task directory relative path",
          "status": "observed | proposed | accepted | deferred | rejected | implemented | obsolete",
          "questionId": "pi-decisions question id, when proposed",
          "responsePath": "archived response path, when decided",
          "decisionNote": "short human rationale, when present",
          "revisitCondition": "only for deferred candidates",
          "updatedAt": "ISO timestamp"
        }
      }
    }
  }
}
```

`targetKey` is a stable hash of repository identity plus route or window, target surface, and the supported theme/viewport class used for comparison. `candidateId` is a stable hash of `targetKey`, control or surface element, one primary axis, and the evidence fingerprint. Use a hash only to make the key stable; the readable fields explain the candidate.

Status rules:

- `observed`: evidence passed all three tests and no question has been opened.
- `proposed`: a `ui-ux-grill-me` question is open or was presented without a selection.
- `accepted`: the human selected the branch; implementation may proceed in a separate authorized task.
- `deferred`: the human explicitly deferred it with a revisit condition.
- `rejected`: the human skipped or rejected it.
- `implemented`: the scoped fix was verified in the target runtime.
- `obsolete`: the source state changed so the evidence no longer applies.

Never re-present terminal statuses. If material evidence changes for a rejected or deferred idea, create a new candidate ID and link the old ID in the evidence note. Keep one open `proposed` candidate per target; wait for its answer before recording another.

Create missing parent directories and write the ledger atomically from one owner at a time. If parsing fails or required fields are missing, stop with `BLOCKED` and preserve the file. Do not prune, cap, or silently rewrite history; the user asked for durable deduplication, not an invented retention rule.

## Safe recurring trigger for the parent

The worker that installs this skill must not create the loop. The parent session owns it and can use the `pi-loop-monitor` tool directly:

```text
LoopCreate
  trigger="idle"
  triggerType="idle"
  recurring=true
  readOnly=false
  prompt="Run one bounded ui-ux-qol pass for the named repository and surface; write only the owner task evidence and var/pi-review/ui-ux-qol/state.json; hand one evidence-backed candidate to ui-ux-grill-me when a human is available; update this dynamic loop exactly once with status=continue and the current state."
```

Omit `maxFires` for continuous operation within the controller lifetime. Use the dynamic loop's `nextInterval` only if the parent wants explicit pacing; no product capacity limit is implied. After every wake, the firing agent calls `LoopUpdate` once with `status="continue"`, state, and metrics. `LoopUpdate status="completed"` is wrong merely because a pass found no candidate.

Prerequisites:

- The user explicitly wants continuous discovery and a named target surface.
- `pi-loop-monitor` is installed and the parent session is live.
- `ui-ux-grill-me`, `pi-decisions`, and a usable browser are installed when decisions are part of the run.
- The target repository has writable `var/` for the ledger and a canonical owner task directory for evidence.
- Read-only browser or desktop access to the target surface is authorized.
- One owner at a time updates the ledger and one question at a time is open per target.

Platform limits that affect “forever”:

- Recurring controllers expire after seven days and must be recreated explicitly. Continuous operation therefore means repeated parent-owned recreation, not a permanent controller.
- A hard `readOnly=true` loop requires `@abhishek944/pi-research`, but its guard blocks ledger writes, `SubmitQuestion`, and other extension tools. It cannot run the full workflow by itself. Use it only for a separate evidence-only discovery pass that hands results to a normal turn.
- Do not use a scheduler or a shell sleep loop. The parent's explicit human confirmation rules for scheduler creation remain unchanged.
