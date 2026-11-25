---
name: secret-handoff
description: Workflow for tasks where the current user, repository, or task policy assigns custody of API keys, tokens, passwords or other secret values to the user. Identify provider and target names, open an applicable provider page or hand off the exact command, prepare only safe blank placeholders, and resume with names-only verification. Does not set a default secret policy for unrelated projects.
---

# Secret handoff

Use this skill only when the active user instruction, repository instruction, or task policy assigns custody of secret values to the user. HighSKU's `agents.md` is one example: it says the user alone handles secret values. This skill implements that assignment. It does not create a global default and does not override a different policy in an unrelated project.

## Activation check

Before applying the boundary below, identify the source of the custody assignment: the current user instruction, a repository instruction such as `agents.md`, or the task policy. Record that source in the work notes. If no such assignment exists, do not impose these restrictions; follow the applicable user and repository instructions instead.

## Custody boundary while activated

- Identify only the provider, account or workplace, project or subscription, environment or config, exact secret name, and intended use. Names, presence, file mode and ownership are enough.
- Do not retrieve, read, copy, print, paste, enter, store, or create secret values. Do not rotate, revoke, inject, write, or transfer them, and do not run commands whose purpose is to reveal or handle a value or capture output that contains one.
- Never ask the user to paste a secret into chat, a ticket, a task record, or a file the agent will read. The user owns entry in their own terminal, secret manager, or provider page.
- Keep values out of argv, shell history, logs, screenshots, environment dumps, browser URLs, and generated code.
- If the custody assignment changes, stop and reconcile the new instruction instead of assuming either the strict boundary or a broader permission.

## Select the target and hand off

1. Resolve names only: provider, account or workplace, project or subscription, environment or config, exact secret name, and what needs the value.
2. Use the provider's official CLI for nonsecret identity and scope facts when one exists. For the secret value itself, choose the provider's own page or the CLI prompt that the user will operate.
3. If a browser is the right surface, use an installed browser skill that matches the situation and follow its current guide. Do not assume a particular browser skill name is present; discover what the host actually has installed. If none applies or is available, hand the user the exact provider page URL and target names so they can act in their own browser.
4. Make the handoff concrete: state what is missing, what will not be touched, where the user should enter or change it, and what brief confirmation lets the agent resume. Never request the value itself.

## Blank entries and existing values

- Check whether the target entry exists using names-only discovery before preparing anything. If it exists, do not blank, overwrite, delete, clone, or rotate it. Hand off with the target names.
- A new blank Doppler entry or equivalent provider placeholder may be prepared only when the target is confirmed absent, the provider or CLI supports a truly empty value, and the action is inside the authorized scope. Report the config and key name only.
- If existence, support, or scope is uncertain, stop at names-only identification and hand off.

## Transparent resume

- While waiting for the user, keep the owning task active or blocked under the host coordination rules with the exact dependency: which secret, which provider and config, which name, which page or command was handed off, and which nonsecret check will resume it.
- When the user confirms completion, do not ask them to repeat or paste the value. Recheck names, presence, config, and the affected nonsecret outcome, then continue from that point. If verification still needs a value, hand off again with the concrete target.
- Report that the user performed the value entry. Report names, presence, and verification results only.

## Boundaries

- This skill grants no provider, production, billing, or deployment authority.
- It does not make the agent a custodian of secret values or replace a provider's own security guidance.
- It does not authorize runtime changes, unrelated provider operations, or unit tests.
