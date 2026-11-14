# Third-party notices

This repository is a curated skills snapshot. The repository's original packaging and documentation use the root [MIT License](LICENSE). Redistributed material retains the following upstream terms.

## Package-owned skills

These skills moved to skill-only Astack packages with unchanged payloads. Their upstream terms, required license texts and provenance now ship with the owning package; attribution is retained here for continuity.

| Skill | New owner | Upstream | License |
| --- | --- | --- | --- |
| `archify` | `packages/pi-visuals` | [tt-a1i/archify](https://github.com/tt-a1i/archify) v3.0.1 at `2ab3cae7ac2c2a55d7386ca789d03c4fcd31816c` | MIT (Archify, Cocoon AI); brand marks and JetBrains Mono have separate bundled terms |
| `visual-explainer` | `packages/pi-visuals` | [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) | MIT, Copyright (c) 2025 Nico Bailon |
| `awesome-logging-standards` | `packages/pi-review` | [khasky/awesome-agent-skills](https://github.com/khasky/awesome-agent-skills) at `58ea4e8915de64907d04cc909a1b8c6e5cf0fcb7` | MIT, Copyright (c) 2026 Khasky |
| `codebase-design` | `packages/pi-review` | [mattpocock/skills](https://github.com/mattpocock/skills) at `d80fa0f4ebe0c5714af0adf8670336065233ecc6` | MIT, Copyright (c) 2026 Matt Pocock |
| `security-audit` | `packages/pi-review` | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) at `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` | MIT, Copyright (c) 2025-2026 Cloudflare, Inc. |

The `agent-review`, `no-unit-tests`, `no-arbitrary-limits` and `ui-ux-testing` skills moved to `packages/pi-review` as original content under that package's MIT license.

`here-now` is retired. Its upstream MIT declaration and pinned provenance were recorded while it was bundled here; the payload, provenance files and global install have been removed, and the independent here.now backend in `pi-decisions` is unaffected.

## typescript-best-practices

- Covered files: `skills/typescript-best-practices/`
- Upstream: [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) at `0317eb8b858c991c57721358daaee19dbe8c814d` (pstack 0.15.36); verified through the standalone mirror [backnotprop/pstack](https://github.com/backnotprop/pstack) at `e388616361ac78eeb2da66c148d882534aca4cb9`
- License: MIT
- Copyright: Copyright (c) 2026 Lauren Tan
- Required text: [`third_party/licenses/pstack-MIT.txt`](third_party/licenses/pstack-MIT.txt)
- Bundled principle revisions: `principle-type-system-discipline` at `99743e9c151c8537cbbf1f98bb38f34ef3368453`; `principle-boundary-discipline` at `d7cde2b84eadbcd6fd890302c876f4436ccb6d82`
- External reference: the optional `principle-encode-lessons-in-structure` pointer links to the verified canonical file at `08bd59b37834550f5e8fa0bb5e8852204a7534cf` instead of naming an unbundled local skill.
- Adaptations: removed Cursor-only `paths` frontmatter and `disable-model-invocation` so Pi's description-based routing can load the skill for `.ts`/`.tsx` work; bundled the upstream `principle-type-system-discipline` and `principle-boundary-discipline` skills under `references/` and updated references to those local files; converted the optional `encode-lessons-in-structure` pointer to its pinned upstream Markdown URL. Rule text and examples are otherwise unchanged.

## browser-use

- Covered files: `skills/browser-use/`
- Upstream: [browser-use/browser-use](https://github.com/browser-use/browser-use)
- License: MIT
- Copyright: Copyright (c) 2024 Gregor Zunic
- Required text: [`third_party/licenses/browser-use-MIT.txt`](third_party/licenses/browser-use-MIT.txt)

## aside-browser

- Covered files: `skills/aside-browser/`
- Upstream: Aside vendor CLI skill entry point (`aside guide` reports `Skill version 4`)
- Supplied: one `SKILL.md` file. The vendor entry point is retained unchanged, with a clearly labeled `## Astack notes (not vendor text)` section appended for this repository; SHA-256 `0997a27d953035335f52da8aa7b9de0ba753c0cdf73d502890a7ac45436b0b0e`
- License: the supplied entry point carries no license text; upstream terms remain with Aside.
- Notes: the file contains no code. It directs the agent to run `aside guide` before browser work and to ask before installing or updating the Aside CLI. The appended Astack notes add account and profile targeting, documented-API, verification and user-browser-safety guidance from this repository's review; they are not vendor text.

## Caveman-derived brevity guidance

- Covered files: `skills/talk-human/SKILL.md` (adapted guidance only; no CLI, proxy, hooks, or telemetry)
- Upstream: [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) at `f5d729488caa8f6a5b6c8086fe2cccd3e8a63f91`
- License: Apache License 2.0
- Copyright: Copyright 2026 Julius Brussee
- Adaptations: condensed the upstream brevity and clarity rules into a self-contained `talk-human` style. Removed mode levels, persistence commands, and terse grammar; retained filler removal, exact technical details, warning and irreversible-action clarity, and persisted-prose boundaries.
- Required text: [`third_party/licenses/caveman-Apache-2.0.txt`](third_party/licenses/caveman-Apache-2.0.txt); earlier MIT contributions are retained under [`third_party/licenses/caveman-MIT.txt`](third_party/licenses/caveman-MIT.txt).

## Herdr skill migration

The Herdr-derived skill is now distributed by [pi-herdr](https://github.com/abhishek944/pi-herdr), not this repository. That package retains the Apache-2.0 license text and original-import provenance alongside its locally adapted skill.

## retro

- Covered files: `skills/retro/SKILL.md`
- Upstream: [mattpocock/skills](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/retro) at `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`
- License: MIT
- Copyright: Copyright (c) 2026 Matt Pocock
- Required text: [`third_party/licenses/retro-MIT.txt`](third_party/licenses/retro-MIT.txt)
- Adaptations: replaced references to the unavailable `Skill` tool and `writing-for-agents` skill with Pi's global `talk-human` skill and local concise-skill guidance; omitted OpenAI-only `agents/openai.yaml` UI metadata. The rest of the upstream skill is retained.

## Linked but not redistributed

The extension packages listed in the README are not copied into this repository. Each remains subject to the license in its linked source repository or npm package.

Some templates load browser assets such as Google Fonts, Mermaid, ELK, Chart.js, or Anime.js at runtime. Those assets are fetched from their named upstream services and are not stored in this repository. Their names, URLs, copyrights, and license terms remain those of their upstream projects.

Product and project names belong to their respective owners.
