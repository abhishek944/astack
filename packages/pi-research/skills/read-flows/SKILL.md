---
name: read-flows
description: Discover and read repository flow documentation before changing a documented workflow.
---

# Read Flows

Before planning or changing a workflow:

1. Check `packages/flows/` and `flows/` at the repository root.
2. If either exists, find Markdown files relevant to the request.
3. Read every matching file in full and follow needed links.
4. Compare the documentation with current code and configuration.
5. Use current code as the source of truth when documentation is stale, and mention important mismatches.

Missing flow documentation is not a blocker.

## Flow reports and visual explainers

Apply this section only when the request asks for a flow report, visual explainer, or walkthrough page. Ordinary workflow changes keep the read-first steps above. This section guides report content; it does not authorize product edits.

Default to the approved mechanics-first style:

1. Read a repository-local report style contract and approved reference before drafting.
2. Lead with one direct conclusion, then at most four one-claim reasons. Add a scope line that names the covered flow, evidence date, and whether the source is current, retained legacy, proposed, or runtime-verified.
3. Organize the rest as question-titled panels. One panel answers one question.
4. Use a native diagram when the answer depends on steps, parts, messages, states, or order. Use short labels and everyday names; put detail in the matching step list.
5. Use tables for comparisons, facts for short labels, callouts for consequences, and a checklist for what the reader can verify. Prefer a calm, spacious layout without decorative chrome.
6. Name the everyday thing first. Introduce an internal name only when it helps the reader recognize code or a log later, and use one term for one thing.
7. Ground errors, retries, and safety in what is saved, delayed, rechecked, or not undone. A stored reminder is intent, not proof that work ran.
8. Keep source paths, symbols, line ranges, commit SHAs, tool output, uncertainty, and stale-document findings in a separate evidence file. User-facing pages must not show internal paths, endpoints, table names, unexplained identifiers, or jargon.
9. Label current product source, retained legacy source, proposed behavior, and unverified runtime behavior. Do not claim exhaustive coverage unless a complete source inventory is linked.
10. State explicitly when a report touches quality, translation, or formula boundaries. Keep those mechanisms distinct instead of implying shared ownership.

For quality flows, keep this distinction exact: invalid, blank or wrong-type product field values are still scored and flagged, earning zero while their weight stays in the denominator. Read-time recalculation is recovery only for a stored result that is missing, stale, or mismatched with saved inputs, catalog rules or expected shape.

Verify the report artifact with the repository's documented finalize or build check, check relative links and browser rendering where feasible, and keep receipts. An automated artifact check is not visual review or live product testing.

Before replying to the user, follow the global `talk-human` skill.

## Session coordination

When available, use `WorkCreate`/`WorkUpdate` and `TodoCreate`/`TodoUpdate` to keep the relevant session work and todos current. Use `MonitorCreate` only for a long-running background command and `LoopCreate` only for a future or repeated wake. Never change works, todos, loops, or monitors during `/ask`.

If notes are useful, follow global `implement` and keep them inside the current owner's canonical task directory (`taskDir`). Reuse the caller's task for the same assignment; standalone work establishes real session/Work/Task ownership first. Delegated work appends its own IDs below the exact supplied parent task directory. Do not create feature-named output roots.

```text
<taskDir>/evidence.md
```

Report which flow documents were read, the constraints they add, and any stale or conflicting guidance.
