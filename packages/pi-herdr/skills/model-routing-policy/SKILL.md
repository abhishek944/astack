---
name: model-routing-policy
description: Choose model, thinking level, and fast mode before launching subagents.
---

# Model Routing Policy

Apply only to subagents, not the parent agent. A delegated worker that conducts a multi-step workflow and parents its own branch owners is still a subagent of the dispatcher for model selection.

Herdr's Routing panel edits this block; it is the policy, and `notes` carries the qualifications that apply to it.

```json
{
  "rules": [
    {
      "model": "openai-codex/gpt-6.1-sol",
      "when": "Production database access",
      "thinking": "high",
      "fast": "off"
    },
    {
      "model": "openai-codex/gpt-6.1-terra",
      "when": "Computer-use or browser-testing execution, including combined Aside + computer use",
      "thinking": "medium",
      "fast": "off"
    },
    {
      "model": "openai-codex/gpt-6.1-sol",
      "when": "All subagents in `grill-me` and `ui-ux-grill-me` sessions, except workers doing computer-use or browser-testing execution",
      "thinking": "high",
      "fast": "off"
    },
    {
      "model": "openai-codex/gpt-6.1-sol",
      "when": "All subagents in `ui-ux-testing` sessions, including audit, component consistency, source investigation, synthesis and caller-requested read-only rechecks, except workers doing computer-use or browser-testing execution",
      "thinking": "medium",
      "fast": "off"
    },
    {
      "model": "opencode-go/deepseek-v4.1-flash",
      "when": "Implementation, research, exploration, design, other non-review work",
      "thinking": "max",
      "fast": "off"
    },
    {
      "model": "openai-codex/gpt-6.1-sol",
      "when": "Review and critique",
      "thinking": "high",
      "fast": "off"
    },
    {
      "model": "openai-codex/gpt-6.1-terra",
      "when": "default",
      "thinking": "medium",
      "fast": "off"
    }
  ],
  "notes": [
    "Production database access takes precedence over every other rule here, including the `grill-me`, `ui-ux-grill-me`, `ui-ux-testing` and computer-use/browser-testing rules.",
    "Production database access means the subagent runs or authors queries, migrations, schema or data changes against a production database, or debugs production data. Local, development, and staging databases do not count.",
    "Computer-use execution means the subagent directly interacts with or inspects a live desktop or computer for its assigned workflow, not necessarily testing. Browser-testing execution means the subagent actually runs or drives a browser test, including combined Aside + computer work. Source or existing screenshot-artifact review, synthesis, planning, and interview conduction by themselves do not count; a worker that actually performs computer use is not excluded because its surrounding workflow is an interview.",
    "The computer-use/browser-testing rule applies only to those executing workers. Other workers in a `grill-me`, `ui-ux-grill-me`, or `ui-ux-testing` session keep their session rule.",
    "The `grill-me` and `ui-ux-grill-me` session rule takes precedence over the `ui-ux-testing` rule and responsibility-based defaults, including for ordinary non-review subagents. It does not override the computer-use/browser-testing rule for workers that actually execute.",
    "The `ui-ux-testing` session rule takes precedence over generic implementation/research and review/critique defaults for every worker assigned to its read-only audit or caller-requested recheck workflow. It does not override the computer-use/browser-testing rule for workers that actually execute. Production database access and enclosing `grill-me`/`ui-ux-grill-me` sessions still use their higher-priority rules.",
    "Explicit user choices override these defaults.",
    "If a subagent malfunctions, stalls, stops unexpectedly, gives incorrect responses, or produces poor-quality work, feel free to replace it or switch its model, while respecting explicit user choices and the production database access requirement.",
    "`default` is not a delegation choice and does not compete with the rules above. It names the model and thinking level the pi-herdr usage fallback switches to when the current model's plan usage is exhausted, so interrupted work can resume; the user authorizes that switch to override every responsibility-specific rule above. It never chooses the model for a new subagent while usage is available.",
    "Usage exhaustion means the provider confirmed the plan or workspace usage limit, not a transient throttle, an authentication or billing failure, a context-window error or a cancellation. The fallback applies the `default` rule's model and thinking level and resumes the interrupted run; it does not force Fast. If that rule is missing or invalid, names the exhausted model, names an unavailable model, or is itself exhausted, pi-tasks auto-continue stops and reports why instead of retrying.",
    "Check model availability before launching.",
    "If the chosen model is unavailable, report the blocker. Do not silently substitute another model."
  ]
}
```
