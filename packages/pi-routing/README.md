# pi-routing

Herdr's **Routing** panel: one place to choose which Pi models subagents may use, and which model
routing policy they follow.

It adds a `Routing` button beside Files, Changes and Schedulers in Herdr's top row, and a Routing
entry to the existing right-hand panel. The panel has two tabs and one fixed footer:

- **Models** — one searchable checklist over Pi's `enabledModels` setting. Checking a model adds it
  to Pi's enabled list; unchecking removes it. The list Pi stores is kept as it is: exact
  `provider/model` ids, `provider/model:thinking` entries, globs and entries that match no model all
  survive a save. A saved entry that matches no model is listed under `ENABLED` as *not in Pi's
  catalogue*; it stays in the settings until you uncheck it there, so the panel never warns about it
  and never drops it on its own. An empty list means every available model, and the panel says so
  instead of pretending nothing is enabled.
- **Rules** — the rules from the `model-routing-policy` skill as cards: model, when to use it, and
  thinking level. `+ Add rule` and a card open one dedicated editor with Back, Model, a roomy When to
  use field and Thinking; the footer's Save and Discard are its only commit and reset controls. Back
  keeps the pending rule and every typed value, so reopening restores it. They are stored as one JSON
  block inside that skill's Markdown body, so there is no second policy file and no generated copy.

`Discard` restores the tab you are on; `Save` writes that tab's whole visible draft, including a
pending editor. Drafts on the other tab are kept while you switch, and a refused or conflicting
save keeps every field and the draft for a corrected retry. Because the editor is part of the draft,
a retry writes the same rule once instead of appending it again.

When to use is a native multiline Textarea in a 160 px padded frame. It wraps and scrolls inside that
frame, and its state carries no `rows` minimum, so the last line and caret stay reachable and visible
instead of being clipped by a minimum taller than the frame's content box.

## What Save does, and what it does not

`Save` persists. It writes Pi's `settings.json` (`enabledModels` only, other keys untouched) or the
current skill file (the JSON block only, frontmatter, prose and notes untouched). A settings save is
refused if that file changed on disk since the panel read it; a policy save re-reads the skill at
save time, so rules edited elsewhere are not treated as a conflict and the external notes survive.
A refused save keeps the editor open with its values and the existing draft, so nothing is lost and
nothing is written twice.

Opening Routing re-reads the current policy. Nothing else is reloaded: no running agent is updated,
interrupted or restarted, and the panel never sends `/reload`. Edits take effect for agents started
after Pi next reloads the skill and settings.

There is no router: matching a task to a rule is still the agent's job, reading the policy skill.
Precedence, exceptions and Fast guidance stay exactly as written in the skill's `notes`, which the
panel leaves alone.

## Install

```sh
# from this package's directory, after npm install && npm run build
node bin/pi-routing.js install
```

The installer copies the mod into `<app home>/mods/pi-routing`, writes the `host.json` that points
the panel at this package's command, and adds the two nodes it needs to your **personal** layout:
`routing-bar` directly after the tabs and `routing` inside the existing `panel-body` stack. It backs
the layout up first, refuses Herdr's shipped layouts, and runs `herdr-app check` on the result.
Running it again changes nothing.

`routing-bar` sits directly after the tab bar and takes a **67 px** slot, exact to its content,
because any spare slot width becomes a gap on its right. Its button pads 1 px left and 3 px right,
which is what makes both of its gaps the same 21.5 px as the tab bar's own buttons, and the highlight
pill is drawn as an overhanging child so it still looks like the other pills. If your UI font is much
wider than the default, raise the slot's `px` in the layout to match the label; the spacing then
grows by exactly the extra width.

## Commands

```sh
pi-routing snapshot --json
pi-routing save-models --draft <file> --expect <sha256|none>
pi-routing save-policy --draft <file>
pi-routing install [--layout <name>] [--force] [--skip-check]
```

The panel is the intended interface; these commands exist because a Herdr mod may only write inside
the app home, so the writes happen in a short-lived Node process instead. Every reply is one JSON
object.

## Layout

```
herdr/pi-routing/     the mod Herdr loads (main.js, dropdown.js, core/, icons)
src/core/             policy and selection rules, pure and shared with the mod
src/host/             paths, Pi model reading, settings and skill writes, installer, CLI
```

`npm run build` compiles `src/` and copies `dist/core` into the mod folder byte for byte, so the
panel and the command always agree on what a valid policy is and what a toggle means.
