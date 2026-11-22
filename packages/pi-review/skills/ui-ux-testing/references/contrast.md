# Rendered contrast protocol

Use this when a UI audit reports, passes, or fails contrast. A palette token, a computed color on a parent, or a ratio calculated from a design artifact is supporting evidence only. The claim is about what a person sees in a rendered state.

## Scope

- Cover each visible text run and functional icon in the audited surface whose color or surface is owned by the change, including labels, placeholders, helper text, status text, button icons, and icons inside controls.
- Treat each distinct role and reachable state as its own case: default, hover, focus, selected, open, disabled, loading, error, and any theme or pane variation the audit already includes. Use the states the repository and the audit scope make meaningful; do not run an unbounded Cartesian product.
- If a state cannot be reached safely, record **NOT RUN** with the missing input. Never transfer a PASS from another state, surface, or theme.

## Evidence to capture

1. Take a full-context screenshot of the live state. Keep enough of the surrounding control visible to identify the actual painted surface behind the glyph.
2. For the foreground and its surface, record the computed colors from the live DOM and the screenshot sample. Resolve the full cascade: inherited color, `currentColor`, `opacity`, `color-mix()`, transparency, gradients, overlays, and stacking contexts. A semi-transparent foreground must be composited over the pixels actually behind it before calculating a ratio.
3. Record the concrete rule or token that set each value and whether it came from a parent, a child selector, a component override, or a theme override. A parent token does not prove the child's color.
4. Use the repository's stated contrast target when it owns one. Otherwise name the accessibility target used for the claim and why it applies to this control; for example, normal text and non-text UI icon guidance are different cases. Keep the target separate from the observed result.
5. Calculate the ratio from the rendered, composited pair and attach the route, viewport, theme, state, selector, colors, ratio, screenshot path and verdict to the coverage matrix. A source-only ratio is labelled **source only**, not a live pass.

Concrete traps this protocol is meant to catch:

- A muted token that is readable on a paper card may be nearly invisible when a component override applies that same token to a small icon inside a saturated primary button. In the Poster Workbench miss, the plus icon kept the muted token on the cobalt button (`#53514c` on `#224bf0` is about 1.26:1) while the white label on that button passed. Check the icon against the button, not the text label against the button and not the token against the paper card.
- A global child selector can override a parent color that looks correct in a screenshot of the container. In the Poster Workbench miss, a light parent color on the dark rail was overridden for rail labels by a global `small { color: var(--cx-muted) }` rule; the rendered pair was `#53514c` on `#151515` (2.304:1), while the audit measured ink on paper. Inspect the text element's own computed color and the rule that set it. Opacity and disabled states need the same composited-pixel treatment.

## Reporting limits

- `PASS` means only that the enumerated rendered pairs and states were checked. It is not an accessibility certification and does not guarantee untested states, themes, zoom levels, or forced-color modes.
- When the live pair cannot be measured, report **BLOCKED** or **NOT RUN** with the exact missing access and preserve the screenshot or computed-style evidence already collected.
- A reported defect needs the natural failing screenshot plus the measured pair. DOM values alone are insufficient, and a corrected token in source is not proof of a rendered fix.
