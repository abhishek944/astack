---
name: research
description: "Read-only repository investigation, debugging, root-cause analysis, and planning before implementation."
compatibility: Requires a repository checkout and normal code-reading tools.
---

# Research

Investigate without changing project files. Leave this mode before implementing a fix.

Before replying to the user, follow the global `talk-human` skill.

## Session coordination

When available, use `WorkCreate`/`WorkUpdate` and `TodoCreate`/`TodoUpdate` to keep the relevant session work and todos current. Use `MonitorCreate` only for a long-running background command and `LoopCreate` only for a future or repeated wake. Never change works, todos, loops, or monitors during `/ask`.

## Rules

- Read repository instructions and discover the real structure before forming conclusions.
- Treat production files as read-only.
- Use the local environment by default. Shared or production systems require explicit permission.
- Never expose secrets, credentials, private data, or raw environment values.
- Use official sources for third-party behavior.
- Separate confirmed facts, likely explanations, open hypotheses, and blocked checks.
- Propose a fix at the boundary that owns the behavior; avoid one-off workarounds.

## Focused evidence

- Start with the question and the narrowest relevant source or documentation roots. Discover filenames with ignore-aware `find` or `rg --files`, then use `grep`/`rg` with explicit paths, globs and precise patterns. Widen only when the evidence points outside that scope; avoid repository-wide shell `find` or recursive grep as the first step.
- Search dependencies, generated output and `var/` deliberately at the exact relevant path, overriding ignores only where needed. Ignore rules reduce noise; they are neither a security boundary nor proof that a file or behavior is absent. Keep secret and access restrictions intact.
- Choose the output before calling: filenames or counts for discovery, bounded context for matches, and selected fields for JSON or tool results. Project large results before returning them to the model rather than dumping full payloads or logs. Forward screenshots and other images as images, not serialized text or base64.
- Batch independent calls by their expected combined output size, not just call count; split large reads. Recover truncated required evidence from the saved full output or successive offset/limit reads until the needed source is complete. A clipped preview or `head` is not complete evidence or an absence check.
- Keep reports concise with exact source paths and the decisive evidence; link retained full detail instead of pasting it. Narrow output must not conceal uncertainty or skip required reading.

## Workflow

1. Restate the question and known evidence.
2. Trace the relevant callers, configuration, storage, integrations, and outputs.
3. Rank plausible causes and identify what would distinguish them.
4. Run only safe, bounded, non-mutating checks.
5. Use separate read-only specialists for logs or databases when those systems are involved; minimize and redact their results.
6. Confirm the leading cause when possible and look for sibling instances.
7. Propose the fix, verification plan, risks, and rollout concerns without applying it.

## Optional diagram handoff

When a source-backed system map, request sequence, data flow, or state diagram would materially clarify the findings, read and follow the global `archify` skill. Pass the feature name, requested slice, verified source paths and line ranges, repository revision, and explicit unknowns. Keep investigation responsible for facts; diagram generation does not authorize production edits. Proposed behavior must be labeled separately, and uncommitted bytes must not be cited as verified `HEAD` evidence. Reuse the current work and todo; keep diagram artifacts inside the canonical owning task directory from global `implement` and pass their exact paths back to the caller. Skip diagrams when prose is clearer.

## Files

When investigation notes are useful, follow global `implement` and write only inside the owning task's canonical directory (`taskDir`). Reuse caller tracking for the same assignment; standalone work establishes real session/Work/Task ownership first. Delegated work appends its own IDs below the exact supplied parent task directory. Feature names remain descriptions, not directory ownership keys.

```text
<taskDir>/evidence.md
```

Suggested files are `evidence.md` and `proposed-fix.md`. Do not create machine state or launch logs.

## Final response

Give the summary, evidence, root cause confidence, proposed fix, verification plan, related candidates, open questions, and next step. Explain the leading cause with a concrete trigger sequence (the trigger, the behavior it sets off, and the consequence), then explain how the proposed fix changes that sequence; label an unobserved sequence as illustrative.
