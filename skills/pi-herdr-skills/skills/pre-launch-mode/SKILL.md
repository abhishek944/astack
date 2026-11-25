---
name: pre-launch-mode
description: Use only when the user explicitly enables pre-launch mode for a named repository, product, service or path. For that scope, assume there are no customers or users yet and the product is still in development, so prefer direct schema and code changes and fresh starts over compatibility shims, migrations and hypothetical user-impact or rollback planning. A live deployment does not by itself mean users exist, and having no customers never makes data disposable, so keep operator data, integrations, declared consumer scope, security, deployment and credential authority and unrelated workloads protected. Without explicit activation, keep conservative compatibility assumptions.
---

# Pre-Launch Mode

Apply this when the user knowingly opts in for a named scope. It changes the assumptions you plan under, not the authority you already have.

Before replying to the user, follow the global `talk-human` skill.

## Activation

- Activate only on an explicit instruction that names the scope, such as "enable pre-launch mode for this repo", "no users yet, change the schema directly", or a project instruction file that states this mode. Restating the fact that a project is new, early, an MVP, greenfield, or has no paying customers is context, not activation.
- Keep the activation to the named repository, product, service or path. An activation written in a project instruction file applies to that project only; never carry it into other repositories, shared infrastructure, shared accounts, vendor or provider configuration, deployment targets, or anyone else's environment.
- Activation lasts for the current task until the user says otherwise. When the scope changes materially, confirm it again rather than letting an old opt-in cover new surface.
- When the request looks like it would benefit from this mode but the user has not enabled it, keep the conservative default below and, if the assumption genuinely blocks progress, ask once whether to enable it. Never enable it silently and never present the assumption as an established fact.
- Record the activated scope, and the fact of activation, in the Work/Todo context or the task plan so resumed and delegated work applies the same scope.

## The assumption in effect

Inside the activated scope, assume zero customers and zero users: no paying customers, no accounts in use, and nobody depending on the current data shapes or API contracts. The product is development-stage and free to change without negotiation.

Deployment status is not a user count. A scope can be built, deployed, publicly reachable, or running in a production environment and still have zero users; none of that weakens this assumption, and none of it grants deployment, infrastructure, provider or credential authority.

This is an authorized working assumption, not a claim about the world. It ends for whatever it touches when a fact establishes users or consumers: real users or customers, an external client or automation reading its data or API, or an explicit statement from the user. It says nothing about which data, integrations or other resources exist or are expendable, so never extend it into those areas — the next section governs them.

## Data and consumer scope

Customer count is not a proxy for data scope. Zero users does not mean zero valuable data: operator-curated datasets, imported corpora, configured provider accounts, connected workspaces and integration state, long-lived local or staging databases, and other people's environments can all be present with no customers at all.

- Take the data and consumer scope from the user and the project instructions. Whatever the current request explicitly authorizes is in scope and needs no extra approval round. Anything outside that granted scope is protected: treat it as not disposable, and ask before deleting, migrating, truncating or replacing it when its status is unclear.
- Resets and fresh starts cover what the user declared disposable or what the request authorizes, including identifiable disposable development or seed state inside the activated scope. Blanket erasure is never implied by this mode; it needs the user's explicit authorization for that target.
- Preserve and reuse operator data and existing integration configuration unless the current request authorizes changing them. Otherwise reconnect to providers, accounts and credentials that already exist instead of creating, rotating or deleting them.

## Preferred approach

- Change schema and shape directly: edit the current model or migration set in place, and recreate disposable development data from the new schema instead of writing additive migrations and backfills for rows that do not exist.
- Replace rather than adapt. Drop compatibility shims, rename and deprecation cycles, dual-read or dual-write paths, legacy adapters, versioned endpoints kept only for old clients, feature flags that exist only to protect old rows, and defensive handling of historical shapes.
- Rename, move, split and delete modules, fields, columns, endpoints and files freely, choosing the clearest current design and following the repository's own conventions.
- Regenerate disposable seed or fixture data instead of preserving it, and recreate an environment you own when that is faster than repairing it and nothing valuable lives in it.
- Skip artifacts nobody can use yet unless the user asks for them: user-impact assessments, deprecation timelines, customer communications, staged rollout plans, backfill scripts, and rollback plans for hypothetical existing users. One short risk sentence is enough.
- Do not turn an authorized reset of disposable development data into a confirmation round; state what you are resetting and proceed. Ask first when the target holds data you cannot identify as disposable.

## What still applies

- Security and correctness do not relax. Keep authentication, authorization, ownership checks, input validation, injection and deserialization safety, secret handling, least privilege, and required cleanup. Never write credentials into source, logs or examples.
- Unrelated workloads stay untouched. Do not stop, restart, replace or reconfigure services you do not own, other repositories, shared infrastructure, CI or production systems, or another person's environment.
- Data, secrets and resources outside the disposable scope stay untouched: not deleted, migrated, truncated, copied or exposed. Before any reset that could reach shared, staging, production or operator-owned data, verify the actual target identity; if you cannot verify it, stop and ask instead of guessing.
- Deployment and provider authority do not change on their own. A live deployment inside the activated scope is not permission to redeploy, migrate production data, change billing or plans, create or rotate credentials, or alter infrastructure you did not authorize for this task; when the user does authorize one of those changes for the task, follow that instruction rather than adding another approval step.
- Explicit constraints win over this skill: the user's instructions, project instructions and `AGENTS.md` files, git and push rules, `no-unit-tests`, `no-arbitrary-limits`, provider, billing and credential limits, and any "do not touch X" statement remain in force.
- Verification stays. Build, type-check, lint, formatting and the real supported flow must still pass from a fresh state; a clean-slate design still has to run, and "it is pre-launch" is not a reason to skip a proportionate check.

## Delegated work

- Pass the activated scope, the data and consumer scope, and the assumption in the assignment, and require the worker to apply them only there. A worker must not widen the scope, and must not treat its own scope-enablement as authority for resets, deploys or deletions its assignment did not include.
- Review delegated changes for hidden compatibility machinery that the scoped assumption no longer justifies, and for scope creep into unrelated surface or protected data.

## Reporting

- Name the scope where the assumption applied, the resets or replacements you performed, the data and integrations you deliberately preserved, and anything you kept compatible because it was outside the scope or explicitly constrained.
- Do not describe the scope as having users, customers or traffic, or as production-ready, without evidence, and do not present the pre-launch assumption as a verified fact about the product.

## Example

"Enable pre-launch mode for this repo; it is deployed but nobody uses it yet" in a repository whose schema still carries an obsolete `billing_account` shape, alongside an operator-curated dataset and a connected provider account used for testing.

Pre-launch handling: change the schema directly, delete the obsolete tables, columns and their adapters, recreate the local development database from the current schema, and remove the rename and deprecation helpers. No backfill migration, no deprecation window, no customer-impact or rollback plan — the deployment being live is not evidence of users.

Still required: the ownership and authorization checks around the new shape, the operator dataset left intact, the existing provider account and its credentials reused rather than recreated, other environments untouched, and a passing build plus the real create-and-read flow against the recreated development data.
