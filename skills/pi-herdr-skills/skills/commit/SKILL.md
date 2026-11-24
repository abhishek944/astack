---
name: commit
description: "Create local milestone commits for coherent, workable, owned changes after verification. Invoked automatically by implement; never pushes, merges, tags, releases, or contacts a remote."
compatibility: Requires a Git repository.
---

# Commit

Create a local commit for an authorized implementation milestone. `implement` discovers and invokes this skill after verification; the user may also ask for a local commit directly. This skill owns local committing only.

Before replying to the user, follow the global `talk-human` skill.

## Authority

- Local commit only. Never push, merge, tag, version-bump, publish, deploy, or contact a remote.
- Automatic invocation is allowed only from `implement` after the milestone's checks and verification passed, with an explicit owned file set.
- Honor any explicit no-commit instruction and the stricter limits of read-only or review skills.
- A local commit never authorizes push, merge, release, or publication.

## Eligibility

- **Coherent:** one owned outcome, not mixed user, agent, or unrelated task work.
- **Workable:** complete enough to pass the proportionate checks and configured hooks for that outcome.
- **Owned:** every candidate path belongs to the current task. If any file, hunk, or staged entry might belong to the user or another task, skip the commit and report the ambiguity.
- **Clean index for automatic commits:** verify that no pre-existing staged entries exist before staging. If `git diff --cached --quiet` does not report an empty index, skip the automatic commit; do not reset, unstage, stash, or work around those entries. A manual commit may proceed only after the user clarifies which staged entries to include or exclude.

## Workflow

1. Confirm the milestone is verified, the owned paths are known, and no explicit restriction forbids committing.
2. Read repository instructions, status, branch, index state, and recent commit style. For an automatic commit, stop if the index is not empty.
3. Run the applicable formatting, lint, typecheck, build, skill-sync, and other configured checks. Let configured hooks run normally. Never pass `--no-verify` or use another hook bypass. A successful `git commit` alone is not proof that checks ran.
4. Stage only the owned paths with explicit paths, such as `git add -- <path> ...`. Do not use broad staging such as `git add -A`, `git add .`, or `git commit -a`.
5. Review `git diff --cached`. Confirm the staged diff contains only this milestone's owned changes and no pre-existing staged entry. If anything is unexpected, stop without committing and report it.
6. Commit with a concise message matching repository style. Verify the commit identifier, message, and remaining status.
7. Report the commit, checks and hooks with their outcomes, and any files left out. Do not push, merge, tag, or publish the result.

## Files

Follow global `implement` and write only inside the owning task's canonical directory when a written record is useful. Delegated work uses its own IDs below the supplied parent task directory. Feature names are descriptions, not output roots.

```text
<taskDir>/summary.md
```

Do not commit `var/` unless the repository explicitly tracks it.

## Final response

State the commit identifier and message, checks and hooks run, whether the index was empty before the commit, files left uncommitted, and explicitly that no push, merge, tag, release, or publication occurred. If the commit was skipped, name the eligibility condition that stopped it and leave the work untouched.
