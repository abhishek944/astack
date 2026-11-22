# Outer-frame and edge-geometry protocol

Use this when a shell, theme or layout change could alter the visible outer frame. A panel can pass contrast, overflow and center-crop checks while its bottom edge or a corner is visibly wrong. The claim is about the rendered outer boundary in a real viewport, not only a CSS declaration.

## Required cases

1. Capture the full viewport before interaction and after each relevant state change. Identify the actual outer edges of the shell, rail, panes and root surface.
2. Add explicit cases for the top, right, bottom and left edges and their corners, including the bottom strip beneath a rail or pane. At 1200×800 and 1440×1000, a four-pixel strip is easy to miss in a full screenshot; take a zoomed bottom-left and bottom-right crop at matching dimensions.
3. Record the viewport in CSS pixels, device scale factor, zoom, pane rectangles, scroll position and the computed geometry that produced each edge: padding, margins, grid rows, sticky siblings, overflow and the painted background behind any inset.
4. Compare each edge with the repository's authored contract. Distinguish:
   - **inherited contract** — documented or source-authored geometry that this change did not introduce;
   - **new regression** — geometry the change altered against that contract;
   - **user concern** — something a person asks to change even if it is inherited. This is a design decision, not a silent auto-fix.
5. If the live state or the governing contract is unavailable, mark the case **BLOCKED** or **NOT RUN** with the exact missing access and acknowledge the unexamined edge in the report. Contrast or overflow evidence does not substitute for it.

## W12/T29 trap

In the Poster Workbench investigation, a four-pixel pale strip below the dark rail was visible in several full-viewport captures but absent from the audit's case list.

- The rendered cause was the dashboard shell's own bottom/right inset: `[data-dashboard]` used `padding: 0 4px 4px 0`, the rail occupied the remaining grid row, and the paper-colored root showed below it. It was not clipping, a short rail element or a Poster-specific override.
- The accepted base-shell geometry already recorded the four-pixel inset. The Poster contract did not require a flush-bottom rail. That made the strip inherited geometry, not a reproduced Poster regression.
- A user asking for a full-bleed rail would be raising a new visual-direction concern for the shared shell. Record it as a flag or decision, not as an obvious local repair.
- The gap was an observation gap: material, contrast, overlay, resizer and overflow cases were covered; no explicit outer-frame case or zoomed bottom-edge crop existed.

## Reporting and recheck

For each edge case, record the edge or corner, viewport, screenshot path, measured geometry, governing rule or contract and the verdict. A passing case covers only the enumerated edges and states; it is not a whole-shell approval.

After an authorized fix, recheck the same edge/corner at the same route, viewport, theme and data state with a new zoomed crop. Confirm adjacent edges and shared consumers of the changed shell too. Keep the original failing evidence intact, and do not infer a pass from a token change, build result or center-crop screenshot.
