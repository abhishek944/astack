# Archify provenance

- Upstream: https://github.com/tt-a1i/archify
- Release: v3.2.0
- Annotated tag object: `e62275b6373fa63436e195635835c313ce028b21`
- Tagged source commit: `208acba8d412335185b2056fedf54b3405df43fb`
- Source tree (upstream stable manifest): `39069dd190f574064fe410aa3af1b6dfd98a522c`
- Release archive: https://github.com/tt-a1i/archify/releases/download/v3.2.0/archify.zip
- Archive SHA-256: `70e210265c59f24dcbdf2a502ff671104b5454e7ee7d3554aecd86bad32384f5`

The complete 200-file release skill bundle is retained. It includes the native
diagram runtime for ten diagram types, the one-page explainer runtime and its
vendored chart subset, references, schemas, examples, generated validators,
viewer assets, locales, brand marks, and notices; it does not include development
tests or node_modules. No npm install is needed for normal CLI use. Upstream
package.json development scripts are retained for provenance, not supported as
this snapshot's maintenance commands.

## Import verification

The archive was downloaded from the v3.2.0 release page and matched the archive
SHA-256 above, which is also the artifact SHA-256 published in the upstream
stable update manifest for 3.2.0. Its file contents were compared against the
tagged source tree with Git blob hashing: 199 of 203 tracked blobs are
byte-identical, the release packaging intentionally rewrites the repository root
`package.json` into the bundle identity (`archify` 3.2.0), and three development
files are correctly absent from the archive (`package-lock.json`,
`scripts/generate-brand-marks.mjs`, `scripts/generate-validators.mjs`). The
archive contains no extra files.

Local adaptations are limited to SKILL.md (shared session coordination, talk-human,
diagram/explainer routing, repository-local var artifacts, truthful evidence and
fallback rules, pinned runtime prerequisites, and the Pi global rules file for the
explainer mode line) and this provenance file. Every other runtime, reference,
schema, example, locale, asset, validator, brand mark, license, notice, and
release-identity file is upstream-exact. Retain LICENSE, THIRD_PARTY_NOTICES.md,
assets/JetBrainsMono-OFL.txt, and explainer/vendor/pele/LICENSE. Brand marks have
separate terms; avoid requesting them unless needed.

Update reminders may contact the upstream update manifest and use Archify's
local cache. They never authorize updating this curated copy. Update through a
reviewed release archive, reapply the documented instruction adaptations, and
verify the runtime in this package's `skills/archify/` directory. Do not install
a second copy of the same skill via another manager.
