---
name: close
description: "Record a worker close retrospective before final handoff: evidence-based skill, codebase, documentation and speed findings written to improvements.md in the canonical session/work/task artifact directory. Changes nothing and creates no follow-up work."
license: MIT
---

# Close retrospective

Run this when the coordinator asks for it, normally by sending `/close` after it has verified your result and decided you need nothing further. A close request that arrives after your assignment report supersedes an earlier assignment line that withheld the retrospective. It records what this session learned so later runs are faster and cleaner. It changes nothing.

## Record location

Resolve the record path before writing anything:

1. With an exact `parentTaskDir` from your assignment, append your own IDs:
   `<parentTaskDir>/<yourSessionId>/<yourWorkId>/<yourTaskId>/improvements.md`
2. In a root session, from the repository root:
   `var/<yourSessionId>/<yourWorkId>/<yourTaskId>/improvements.md`
3. If no work or task record exists:
   `var/<yourSessionId>/improvements.md`

The record is a single `improvements.md` file sitting directly in the canonical task directory, with no `improvements/` subdirectory and no session-named filename. The session directory already identifies the session, so the filename stays fixed. Leave an existing `improvements/<sessionId>.md` record from an earlier run where it is; do not move or copy it into the new location.

Append your own session, work and task IDs; never write beside `parentTaskDir` itself or into a sibling directory that only looks close. When this session has several tasks, use the task that owns the assignment being closed, not a neighboring one.

Read your own session ID from your shell (`printf '%s\n' "$PI_SESSION_ID"`) and your Work and Task IDs from the real tracking tools. Never invent IDs, never reuse the parent's IDs, and never write outside the repository's `var/` directory. If your identity or tracking is unavailable, report that blocker instead of writing.

## What to record

Read the existing file first and merge into it. Keep one entry per distinct finding, add new evidence to the existing entry, correct or remove entries that later evidence disproved, and preserve unrelated entries. Repeated runs must not duplicate findings.

Record only findings this session produced evidence for:

- **Skill improvements** — instruction gaps, or workflow patterns in a skill, prompt, template or assignment that caused a wrong turn, an unnecessary step or a repeated explanation. Name the skill or instruction file.
- **Codebase improvements** — workflow, tooling, build, check-command or maintainability changes in this repository that would make future runs faster or less error-prone, each stating the step or time it removes. This section records process cost; ordinary product defects belong in your assignment result, not here.
- **Documentation improvements** — repository documentation, architecture notes or flow docs that were missing, wrong or expensive to read. Name the document and the fact it should state.
- **Speed opportunities** — the slow step, what it cost, and the change that would remove it. Cite a measured cost only when it is attributable to that step, such as a command's elapsed time or a recorded retry; otherwise describe the observed wasted step or round trip and write `not measured`. Never estimate a number. Say whether the cause is skill-level, documentation or codebase-level, and name the file the change would land in.

Each entry:

```md
### <short subject>
- Evidence: <repo-relative or taskDir-relative path written without `...`, command, task ID, observed delay or failure>
- Benefit: <what improves for future runs>
- Next step: <smallest concrete change; no code>
```

Order entries by impact within each section, and let a measured time saving outrank a cosmetic defect. When a finding is both an instruction gap and a removed step or round trip, file it under Speed opportunities and name the owning file in its Next step. Write `No evidence-based findings.` for an empty section instead of padding it. Do not restate the assignment, do not list routine steps as findings, and do not turn general opinion into an improvement.

Record the session outcome at the top as `Completed`, `Blocked` or `Interrupted`, with the one-line evidence and the per-section counts. Blocked or partial work must not be described as complete.

## What not to record

- No secrets, tokens, credentials, raw logs, full transcripts or personal data. Reference a command or path instead of pasting its output.
- No edits to skills, code, configuration or settings, and no commits, branches, pushes or deployments.
- No follow-up tasks, Todos, agents or scheduled work for these findings.
- No terminal, session or monitor cleanup. The coordinator verifies this record and then closes the worker.

## Final handoff

Report the record path, the outcome line, the per-section counts, and the single highest-impact finding. Keep it short; the coordinator reads the file for detail.
