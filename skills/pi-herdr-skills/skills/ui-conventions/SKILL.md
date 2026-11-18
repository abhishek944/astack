---
name: ui-conventions
description: "Find the UI components, design tokens and interaction patterns a repository already has before creating, restyling or reviewing an interface control. Use for work on dropdowns, selects, menus, popovers, dialogs, tooltips, buttons, form fields, panels, tables, icons, themes or user-facing interface copy in any app or shared UI package."
---

# UI conventions

Follow global `implement` for ownership and tracking. This skill is a discovery and
consistency guide. It does not authorize changes, restyling, refactors,
consolidation or a design-system migration. Do only what the user asked for, in the
surface they named.

The problem this addresses is concrete: a product ends up with several dropdowns
that look and behave slightly differently, so there is no single answer to "what
does a dropdown look like here, and what does the keyboard do?" Reusing what exists
prevents most of that. Merging what already diverged is a separate job.

## The one rule

**Look before you build.** The control you are about to write has probably been
written already — perhaps in this app, perhaps in a shared package the app imports,
perhaps in a feature folder two levels away. Search first, read the closest match,
reuse it when it fits. When it does not fit, add what you need and say what you
reused and what you added.

Discovery is not a mandate to consolidate. Do not migrate call sites, retire a
duplicate, or unify patterns unless the user asked for that specific change.

## 1. Project instructions and the existing design system win

This skill is generic. The repository is not. Before applying anything below,
establish what already governs UI in that repository, and treat it as binding:

- Agent and contributor instructions (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
  `.cursor/rules`, `.github/` guidance).
- Design-system documentation, storybook, tokens packages, theme files.
- An established component library, wrapper layer or styling system already in use.
- Lint, format and type rules that constrain how components are written.

Loaded project instructions override this skill wherever they conflict. **Do not
reinterpret an instruction so that your change fits it.** If a project rule names a
mechanism — a wrapper layer, a shared library, a CSS approach — treat it as
authoritative even when the current code does not match it.

When the instruction and the actual tree disagree, that is a **mismatch to surface,
not a side to pick**:

- State the rule and quote it.
- State the observed fact with evidence: the manifest entry, the directory that does
  or does not exist, the import that is or is not present.
- Then choose the path that stays inside both:
  - If your change can be delivered with patterns the repository already uses, do
    that. Reusing an existing primitive raises no conflict with the rule.
  - If compliance requires adding a dependency, a new wrapper layer, a new styling
    system or a new directory, **stop and ask** which contract governs. That is a
    dependency and architecture decision the user owns.
  - If compliance and the existing code are genuinely incompatible for the work you
    were asked to do, report the incompatibility and the exact choice needed. Do not
    resolve it unilaterally, and never finish a task by deciding the rule does not
    apply.

## 2. Find where UI lives in this repository

Build a small map before you write code. None of these steps requires prior
knowledge of the project.

```bash
# Manifests and workspaces tell you what is an app and what is a shared package.
ls
cat package.json
rg -n 'workspaces|"name"' --glob 'package.json' -g '!**/node_modules/**' | head -50

# Where do components live?
rg --files -g '*.tsx' -g '*.jsx' -g '*.vue' -g '*.svelte' -g '*.css' \
  | rg 'components/|ui/|primitives/' | head -80

# Is there a wrapper or design-system layer?
rg --files | rg 'components/ui/|/design-system/|/primitives/|/tokens\.' | head -40

# Is there a shared UI package?
rg -n '"@[^"]*/(ui|design-system|components)[^"]*"' --glob 'package.json' | head -20
```

Then answer these, in this order:

1. **Which app am I editing, and is it the live one?** Repositories often keep a
   current app beside a retained or deprecated one. Check manifests, root scripts and
   any architecture or workspace doc before assuming the obvious directory is active.
2. **Is there a shared UI package the apps import?** If two apps exist, a primitive
   in the shared package is usually the intended home; a primitive in one app usually
   is not.
3. **Is there a wrapper layer?** A `components/ui/` directory, a re-export barrel, or
   a wrapper that hides a third-party primitive behind local API is the reuse target,
   not the third-party package directly.
4. **Who already uses the thing I am about to build?** Call-site search is the
   fastest way to learn the intended usage and the props that matter:

   ```bash
   rg -n 'Button|Select|Dialog|Popover|Dropdown' --glob '*.tsx' -g '!**/node_modules/**' \
     | rg -v 'export (function|default|const)'
   ```

5. **What do the tokens and themes say?** Find the token source (CSS custom
   properties, a theme object, a Tailwind config, a design-token JSON) before
   hard-coding any colour, spacing or radius. If several themes are supported, the
   token file tells you which ones.
6. **Is there documentation for this surface?** Flow docs, ADRs, or the app README
   often state invariants you would otherwise break. Follow the global `read-flows`
   skill when the repository keeps flow documentation.

## 3. Read the nearest match in full

Before reusing a component, read it, not just its props. You need its dismiss and
focus behaviour, its theme handling, its disabled and loading states, and its
accessibility attributes, because those are the parts that drift when a second
version is written.

Do the same for its stylesheet. A primitive is its own DOM plus its own CSS; copying
the markup without the CSS is how a near-miss appears.

If the component has tests, stories or snapshots, skim them for behaviour you would
not infer from the implementation.

## 4. Choosing: reuse, extend, add, consolidate

Work down the list and stop at the first option that satisfies the task.

1. **Reuse.** An existing component does the job. Import it. No new CSS.
2. **Extend.** An existing component does most of the job. Add a prop, variant or
   slot inside it and its stylesheet, so callers stay declarative and the variant
   stays in one place.
3. **Add locally.** Nothing fits. Build next to your first consumer, follow the
   repository's naming and styling conventions, and reuse its tokens.
4. **Consolidate.** Move a local pattern into the shared layer and migrate its
   callers. This is a refactor with real risk. Do it only when the user asked for it,
   and then preserve each call site's behaviour.

Options 1–3 are local and low risk. Option 4 is not free, and this skill does not
imply it.

Do not add a UI dependency — a component library, a headless primitive, a styling
framework — because the existing components "did not quite fit". Ask first. A second
styling system in one app is the outcome this skill exists to prevent.

## 5. Behaviour to preserve, matched to the control

Accessibility and interaction requirements come from the element and the platform,
not from a house checklist applied blindly. The same rule that protects a menu is
irrelevant to a native `<select>`, which gets its own keyboard handling from the
browser.

Match the control type first; then check what the existing components of that type
already do, and follow them so the app stays predictable.

| Control | What to check |
| --- | --- |
| Native `<select>`, `<input>`, `<button>` | Prefer the native element. Custom replacement is a decision, not a styling change. |
| Menu / dropdown | Reachable by Tab; arrow keys move within it; Escape closes only it and returns focus to the trigger; outside pointer-down dismisses; `role="menu"` with `role="menuitem"`; `aria-expanded` and `aria-haspopup` on the trigger. |
| Listbox / combobox | `role="listbox"` with `role="option"`, `aria-selected`, an accessible name, and a documented rule for whether Enter can activate an unresolved result. |
| Dialog | `role="dialog"`, `aria-modal`, a labelled title, focus moved in and restored on close, Escape scoped to the dialog, and a visible close control. |
| Tooltip / hover help | `role="tooltip"`, shown on focus as well as hover, dismissible, and not the only carrier of a required instruction. |
| Any overlay | Check whether ancestor clipping or scroll containers break it; several repositories already solve this with the native popover API. |
| Icon-only button | An `aria-label`; decorative glyphs `aria-hidden`. |
| Anything themed | Verify every supported theme, and `@media (forced-colors: active)` where the control is drawn with an image, gradient or pseudo-element. |
| Anything animated | `@media (prefers-reduced-motion: reduce)`. |

When no existing component of that type exists, follow the element's own semantics
and say which decisions you made. Do not invent a repository-wide contract in the
middle of one task.

## 6. Interface copy

Interface copy is part of the control, not decoration. Before writing or keeping a
hint, caption, placeholder, helper line or empty-state sentence, read the global
`ui-copy` skill and apply its tests.

Two habits matter most here:

- **Classify per claim, not per string.** One caption often carries two statements
  with different standing. A line like `Saved view: All products · working changes
  are not saved automatically` bundles a restatement with a consequence; deleting it
  to remove the repetition takes the consequence with it.
- **Verify a consequence in the code before calling it filler.** "Not saved
  automatically" is a real warning if unsaved state is held only in memory and a
  reload discards it. Read the state module before judging the sentence.

Lines that carry lost work, destructive confirmation, a refusal, a limit or a
required input format, or text a screen-reader user needs, stay unless you replace
them with something equally clear.

## 7. Verify

Use the repository's own scripts, discovered from the manifests rather than assumed:

```bash
# Typecheck, lint, format and build are usually declared per package or at the root.
cat package.json         # look at "scripts"
cat apps/<app>/package.json
```

Then run the app and exercise the control for real. A static check does not prove
that an overlay opens in the right place near a viewport edge, that Escape returns
focus, that the control is readable in every theme, or that the copy you removed was
not the only place a consequence was stated.

State which checks you actually ran. If you could not run the app, say so and give
the exact steps instead of implying the check passed.

## 8. Anti-patterns

- Reinterpreting a project instruction so the change fits, or deciding it does not
  apply to the tree you are editing.
- Adding a second styling system or component library without agreement.
- Copying markup from an existing component without its stylesheet and behaviour.
- Hard-coding a colour, radius or spacing value that a token already defines.
- Building a near-miss variant instead of searching for the existing one.
- Migrating call sites nobody asked you to migrate.
- Applying one accessibility checklist to every control type regardless of the
  element's own semantics.
- Deleting a consequence because it shared a sentence with a restatement.

## 9. What to report

For a UI change, the useful short report is:

- which components you reused, and from where;
- what you added, and why the existing ones did not cover it;
- any mismatch you surfaced between project instructions and the tree, and the
  choice you need from the user;
- which checks you ran, and which you could not.
