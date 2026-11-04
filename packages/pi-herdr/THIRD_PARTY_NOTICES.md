# Third-party notices

## Agent tools

The Agent lifecycle implementation and supporting CLI/rendering code were extracted from the current working source of [abhishek944/pi-tasks](https://github.com/abhishek944/pi-tasks), copyright (c) 2026 Abhishek Tatikella, under the MIT License. The MIT grant is preserved in [LICENSE](LICENSE).

## Herdr skill

- Covered files: `skills/herdr/`.
- Upstream: [herdrdev/herdr](https://github.com/herdrdev/herdr).
- License: Apache License 2.0; see [required license text](third_party/licenses/herdr-Apache-2.0.txt).
- Origin recorded by pi-herdr-skills: a generated skill from installed Herdr 0.8.2, with original SHA-256 `98d25cfb19404df5632c0468ec9b094fa99c3108ed2e5f621bdf8e0e1429dc51`. That hash identifies the original import, **not** the currently bundled bytes.
- The bundled copy comes from the current pi-herdr-skills working source and includes local adaptations for Core/hc, visible app tabs, Pi agent tools, monitoring, tracking, artifact ownership, and delegated timing. This extraction updates the package owner reference to pi-herdr. The upstream repository had no NOTICE file at the recorded import.

The MIT license for Agent code does not relicense the Apache-2.0-derived skill. The bundled `skills/model-routing-policy/` skill is original package content under that MIT license and contains no third-party material.
