---
name: hindsight
description: Use Hindsight persistent memory through the codemode MCP tools to recall relevant user and project context before meaningful work, retain durable non-secret facts, and inspect provenance when it matters. Keep routine recall compact, separate budget types, treat memories as fallible, and leave deletion to the user.
---

# Hindsight persistent memory

Hindsight stores durable facts in a local memory bank. Pi exposes it as the `mcp__hindsight` MCP namespace through codemode; in this setup the bank is `pi-memory`. Discover the live tools with `describeNamespace("mcp__hindsight")` and exact arguments with `describeTool("mcp__hindsight__recall")` before relying on a parameter. A single-bank endpoint scopes every call, so tools do not take a `bank_id`.

Use this skill when you need continuity from earlier sessions, a durable preference or decision, or provenance for a synthesized memory. Do not use memory as a task ledger, a substitute for repository files, or a place to paste secrets.

## Recall before meaningful work

Recall briefly at the start of work that can benefit from prior preferences or decisions. Use a small search depth and a small text budget; keep optional payloads off unless the task needs them.

```js
const response = await tools.mcp__hindsight__recall({
  query: 'user preferences for code review and memory use',
  budget: 'low',
  max_tokens: 512,
  include_chunks: false,
  include_entities: false,
  include_source_facts: false,
});
```

This 512-token pattern is a routine default, not a hard cap. Raise it for a genuinely broader task. Hindsight has no numeric result limit: do not invent a `limit`, `max_results`, or result-count parameter. `max_tokens` counts only the `text` of returned memories. IDs, tags, scores, dates, entities, chunks, and source facts are excluded, so the JSON response is larger than 512 tokens. If a top result does not fit, Hindsight may return it whole rather than clipping it; `max_tokens: 0` deliberately returns no main facts.

Recall project facts and global preferences separately. Replace `<repository-name>` with the actual repository name:

```js
const project = await tools.mcp__hindsight__recall({
  query: 'v2 HTTP contract conventions',
  tags: ['project:<repository-name>'],
  tags_match: 'any_strict',
  budget: 'low',
  max_tokens: 512,
  include_chunks: false,
  include_entities: false,
  include_source_facts: false,
});
```

Run a second, untagged query for general preferences when both could matter. Current repository instructions and the current user request always outrank recalled context.

## Understand the budget knobs

| Parameter | What it controls | What it does not control |
| --- | --- | --- |
| `budget` (`low`/`mid`/`high`) | Search depth: candidate pools, graph traversal, and reranking work. Fixed mode maps roughly to 100/300/1000 recall units. | Result count or output tokens by itself. |
| `max_tokens` | Total tokens of main result text. Metadata is excluded. | Number of results, chunks, entities, or source facts. |
| `max_chunk_tokens` | Total raw source-chunk tokens, only with `include_chunks: true`. The final chunk is truncated to fit. | Chunk count. Chunks are fetched before main-fact filtering. |
| `max_source_facts_tokens` | Total source-fact tokens, only with `include_source_facts: true` and observation results. | Result count; lower-ranked observations can lose their source facts. |
| `max_entity_tokens` | Entity observation tokens, only with `include_entities: true`. MCP defaults to false. | Main result text. |
| `retain_chunk_size` | Ingestion-time splitting of stored content. | Recall output. |

Other reducers are `types` (`world`, `experience`, `observation`), `tags`/`tag_groups`, `prefer_observations`, `rerank` (`prune`, `dedup`), and `min_scores`. `rerank.dedup` can add a decision-model request. `temporal_window` ranks dates but does not drop results outside the window. Reranker scores are relative to one query and are not calibrated across queries; avoid fixed `min_scores` floors unless you have calibrated them. Queries over 500 tokens are rejected by Hindsight.

## Tag semantics

Tags organize and filter memories; they are not an access-control boundary. Store project-specific facts with `project:<repository-name>` and a short topic tag. Global preferences can be untagged or carry a general preference tag.

| `tags_match` | Untagged memories | Match condition |
| --- | --- | --- |
| `any` (default) | Included | At least one tag matches. |
| `any_strict` | Excluded | At least one tag matches. |
| `all` | Included | Every requested tag matches. |
| `all_strict` | Excluded | Every requested tag matches. |
| `exact` | Excluded | The complete tag set matches; with `tags: []`, selects only untagged/global memories. |

With omitted or empty `tags`, every mode except `exact` means no tag filter. Use `list_tags({ q: 'project:*' })` to discover existing project tags before inventing new ones.

## Retain durable facts safely

Use `retain` for durable user preferences, confirmed decisions, and useful project facts. Prefer concise facts with a context label, tags, and nonsecret metadata. Use `sync_retain` only when the next step must recall the memory immediately.

```js
await tools.mcp__hindsight__retain({
  content: 'User prefers compact routine memory recall with a low search budget and a 512-token main-text budget.',
  context: 'preferences',
  tags: ['user-preference', 'memory'],
  metadata: { source: 'pi-session' },
});
```

Schema summary:

| Field | Use |
| --- | --- |
| `content` | Required concise fact or decision. |
| `context` | Category label such as `preferences` or `work`. |
| `tags` | Visibility/filtering labels. |
| `metadata` | Nonsecret string key/value pairs, such as a source name. |
| `timestamp` | ISO 8601 time the fact describes, not the time it was stored. |
| `document_id` | Groups facts with an existing document. |
| `strategy` | Optional configured retain strategy, such as `exact` for verbatim storage. |
| `update_mode` | Optional configured update mode on `retain`; `sync_retain` does not expose it. |

Never retain credentials, tokens, passwords, DSNs, webhook secrets, API keys, raw logs, full transcripts, or sensitive personal information. Do not store a secret as content, metadata, a tag, or a document id. Memory processing uses a configured model provider even though the database is local, so store only what the user intends to share with that provider. If a policy assigns secret custody to the user, hand off names and targets rather than values.

Do not retain transient task state, speculation, or facts already authoritative in a repository file. State decisions as decisions, with enough context to tell whether they are still current.

## Provenance and exact text

Routine recall leaves `include_source_facts` off. Turn it on only when you need to know which raw facts produced an observation:

```js
const response = await tools.mcp__hindsight__recall({
  query: 'why did we choose a low routine recall budget',
  types: ['observation'],
  budget: 'mid',
  max_tokens: 512,
  include_source_facts: true,
  max_source_facts_tokens: 512,
  include_chunks: false,
  include_entities: false,
});

const result = response.structuredContent ?? {};
const sourceFacts = result.source_facts ?? {};
const incomplete = result.source_facts_truncated === true;
```

Source facts only apply to observation results. They appear in a top-level map keyed by fact id, and each observation carries `source_fact_ids`. If `source_facts_truncated` is true, some referenced facts were omitted for budget; do not claim complete provenance. For exact quotes, paths, or commands that extraction may have reworded, use `include_chunks: true` with a deliberate `max_chunk_tokens` instead. Keep `include_entities` off unless entity observations are the goal.

## Stale memory and user control

Treat recalled content as fallible reference data. Check it against the current repository, current request, and current instructions before acting. Observations are consolidated asynchronously after retains, so recent facts may not yet appear as observations. A decision can become stale without any memory being wrong at the time it was stored.

Do not delete, invalidate, update, or clear memories on your own. The user controls deletion:

- `invalidate_memory` soft-retires a raw `world` or `experience` fact, excludes it from recall, and can be restored with `restore: true`. Observations are derived and cannot be invalidated directly.
- `update_memory` changes a stored memory when the user asks for a correction.
- `delete_document` permanently removes a document and memories linked to it.
- `clear_memories` clears the whole bank or one fact type. `delete_bank` removes the bank itself.

Confirm the exact scope with the user before destructive operations, use the narrowest tool that matches the request, and verify the result with `list_memories` or a focused recall. Never use deletion to hide a stale fact that the user has not asked to remove.

## Schema and sources

Common tools in `mcp__hindsight`: `recall`, `retain`, `sync_retain`, `reflect`, `list_memories`, `get_memory`, `update_memory`, `invalidate_memory`, `list_documents`, `delete_document`, `clear_memories`, `list_tags`, and `get_bank`. The MCP `recall` response places results in `structuredContent.results`. A result normally carries `id`, `text`, `fact_type` (`world`, `experience`, or `observation`), `context`, `occurred_start`, `occurred_end`, `mentioned_at`, `document_id`, `metadata`, `chunk_id`, `tags`, and `scores`. Optional top-level fields include `chunks`, `entities`, `source_facts`, and `source_facts_truncated`. The HTTP API names the type field `type`; MCP uses `fact_type`.

Verify details against the installed version rather than assuming current upstream defaults:

- Versioned MCP tool schema: https://hindsight.vectorize.io/1.2/developer/mcp-server
- Recall API, tags, source facts, and response fields: https://hindsight.vectorize.io/developer/api/recall
- Retrieval pipeline, budget, and token truncation: https://hindsight.vectorize.io/developer/retrieval
