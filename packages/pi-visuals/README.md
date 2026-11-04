# pi-visuals

Two skill-only Pi workflows for diagrams and visual explanations:

| Skill | Purpose |
| --- | --- |
| `archify` | Renders and validates interactive architecture, workflow, sequence, data-flow, and state diagrams as standalone HTML with inline SVG, dark/light themes and PNG/JPEG/WebP/SVG/WebM export. |
| `visual-explainer` | Produces a self-contained HTML page that visually explains a system, change, plan, comparison, or structured data. |

This package contains only skill instructions and their bundled runtime, references, schemas,
examples, brand marks and assets. It registers no extension code, custom tools, server or model.

## Install

Requires Pi 1.4.0 or newer and Node.js 22 or newer. Archify's full automated browser gate also
requires Chrome or Chromium.

From an Astack checkout:

```sh
pi install ./packages/pi-visuals
```

Or use the package directory's absolute path:

```sh
pi install /path/to/astack/packages/pi-visuals
```

Run `/reload` in an open Pi session, or restart Pi, after installing or changing packages. Confirm
the package is configured with `pi list`.

The package is not published on npm. Publish manually from this directory when a release is
intended.

### Migrating from the shared skills repository

`archify` and `visual-explainer` were previously owned by the `pi-herdr-skills` shared skill
repository and its global installer. This package is now their source of truth. The payloads are
unchanged; only their owner moved.

If the old global copies exist, inspect and back up `~/.agents/skills/archify/` and
`~/.agents/skills/visual-explainer/`, then remove those two directories after the package is
configured. The shared installer does not remove retired directories automatically. Do not keep
both the global copies and the package loaded: Pi keeps the first discovered skill and warns about
the duplicate name.

`visual-explainer` routes standalone technical diagrams to `archify`, and the `pi-research` and
`pi-review` skills reference both by name. Keep this package installed alongside them.

## Update the bundled Archify runtime

The complete pinned [Archify v3.0.1](https://github.com/tt-a1i/archify/releases/tag/v3.0.1)
runtime is bundled under `skills/archify/`; no npm install or separate skill-manager install is
needed. Update through a reviewed release archive, reapply the documented instruction
adaptations, and verify the runtime and packaged files. Do not install a second copy through
another skill manager. See [provenance](skills/archify/PROVENANCE.md).

Archify may check its upstream update manifest and cache a reminder; it does not automatically
install updates.

## Licensing

The package's original packaging and documentation are MIT licensed; see [LICENSE](LICENSE).
Redistributed material keeps its upstream terms: Archify is MIT, retains its own license, notices,
provenance, brand-mark terms and JetBrains Mono SIL Open Font License, and `visual-explainer` is
MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Some templates load browser assets such as Google Fonts, Mermaid, ELK, Chart.js, or Anime.js at
runtime. Those assets are fetched from their named upstream services and are not stored in this
package; their names, URLs, copyrights and license terms remain those of their upstream projects.
Product and project names belong to their respective owners.
