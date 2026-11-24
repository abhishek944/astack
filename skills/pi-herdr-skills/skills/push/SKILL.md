---
name: push
description: "User-invoke only. Push existing local commits to an explicitly authorized remote and ref after applicable checks; never commits, merges, tags, releases, or force-pushes."
compatibility: Requires a Git repository and an explicit push request.
disable-model-invocation: true
---

# Push

Push existing local commits. Use this skill only when the user explicitly asks to push or invokes it; `implement` never invokes it automatically.

Before replying to the user, follow the global `talk-human` skill.

## Authority

- Push only. Do not create commits, merge branches, create or move tags, bump versions, publish packages, or deploy.
- The user's request must identify, or unambiguously establish, the remote and ref to update. Ask if either is unclear.
- Never force-push. A non-fast-forward update is a stop condition, not a reason to add `--force` or a lease override.
- A local commit, merge, tag, or test result is not push authority by itself.

## Rules

- Read repository instructions, status, branch, upstream, and recent commit style before pushing.
- Do not stage, unstage, reset, stash, or otherwise alter unrelated work. Leave uncommitted and pre-existing staged work untouched.
- Run the applicable formatting, lint, and configured hooks for the pushed commit set. Let hooks run normally; never use `--no-verify` or another bypass. Report the exact checks and results.
- Inspect the local and remote ref state before pushing. If the remote is unavailable or the update is not fast-forward, stop and report the evidence.
- Verify the resulting remote ref after a successful push.
- Do not push tags unless the user explicitly names the tag and its destination.

## Workflow

1. Confirm the explicit push request, the authorized remote and ref, and that no merge, release, or publication was authorized by it.
2. Inspect local status, branch, upstream, and the remote ref state. Stop on ambiguity or a non-fast-forward update.
3. Run applicable formatting, lint, and configured hooks. Report their results; do not bypass a failing hook.
4. Push normally to the authorized remote and ref. Never force-push.
5. Verify the remote ref, report the local range pushed, and state that nothing was committed, merged, tagged, released, or published by this workflow.

## Files

Follow global `implement` and write only inside the owning task's canonical directory when a written record is useful. Delegated work uses its own IDs below the supplied parent task directory. Feature names are descriptions, not output roots.

```text
<taskDir>/summary.md
```

Do not commit `var/` unless the repository explicitly tracks it.

## Final response

State the remote and ref pushed, the local commit range, checks and hooks with their outcomes, and the verified remote result. State explicitly if no push occurred and why. Do not claim commit, merge, tag, release, or publication authority.
