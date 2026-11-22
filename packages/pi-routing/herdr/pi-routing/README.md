# pi-routing pane

Two roles from one mod, picked by `props().slot`:

- `bar` — the block in Herdr's top row, beside Files, Changes and Schedulers. It uses native
  `layout.select/show/hide` on the existing right-panel stack and registers `routing` in
  `workspace.panels` so Herdr restores the person's per-space choice.
- `panel` — the `routing` child of native `panel-body`: Models and Rules tabs, scrolling content,
  and a fixed footer with Discard and Save.

**Models** is one searchable checklist over Pi's `enabledModels`. Checking and unchecking is staged
until Save; the stored list is never flattened silently — exact ids, `:thinking` suffixes, globs and
entries that match no model are all kept, and an empty list is reported as "every available model".
Pi's own resolution decides which models are checked, so a saved entry that resolves to nothing is
listed under `ENABLED` as "not in Pi's catalogue": it stays in Pi's settings, and in that list,
until it is unchecked there.

**Rules** are the `model-routing-policy` skill's rules as cards: model, when to use the model, and
thinking level. `+ Add rule` and a card both open a dedicated editor that replaces the list, with
Back, Model, a roomy When to use field and Thinking. Back is navigation: it keeps every typed value
and the pending rule, so reopening restores it. The footer's Discard and Save are the only reset and
commit controls; there is no inner Add, Done or Cancel. The cards are backed by one JSON block inside
the skill's Markdown body; `notes` beside them hold the policy's precedence, exception and Fast
guidance verbatim and are never rewritten by the panel.

When to use is sized by its padded frame (160 px) and scrolls internally; the Textarea state carries
no `rows` minimum, so a row minimum can never be taller than the frame's content box and clip the
last line.

Writes happen where the mod cannot reach: Pi's settings and the skill live outside the app home, so
Save hands a draft to the package's Node command through `exec` (`host.json`, written by the
installer). Settings writes are compare-and-swap on the file the panel read. Policy writes re-read
the current skill and replace only its rules, leaving frontmatter, prose and notes alone; an edit
made elsewhere is applied rather than reported as a stale conflict. Opening Routing re-reads the
current policy. A Save writes the whole visible draft once — a pending editor included — so a retry
can never append the same rule twice. Save persists only: no `/reload`, no agent update, no restart,
no application queue.

The panel is a normal Herdr mod: no overlay, no second window and no background process. The bar
button never starts anything; it only shows or hides the native panel and selects this content.

Checks:

```sh
herdr-app check ~/.config/herdr-app/mods/pi-routing
herdr-app status
herdr-app shot /tmp/routing.png
```
