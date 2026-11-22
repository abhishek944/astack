// pi-routing: Herdr's Routing panel.
//
// One class, two roles chosen by `props().slot`:
//   bar    the button in the top row beside Files, Changes and Schedulers. It
//          selects the existing right-panel stack entry and registers it for
//          Herdr's per-space panel memory.
//   panel  the panel itself: Models (Pi's enabled models) and Rules (the
//          model-routing-policy skill), with Discard and Save.
//
// The panel writes nothing outside the Herdr app home by itself: Pi's settings
// and the skill live elsewhere, so Save hands a draft to the package's host
// command through `exec`. Nothing here starts Pi, a session or an agent, and no
// save asks a running agent to reload anything.
import { View, div, svg } from "gpui-kit";
import { Button, Checkbox, h_flex, Input, InputState, Textarea, TextareaState, v_flex } from "gpui-base";
import { appHome, exec, layout, nextCommand, notify, props, readTextFile, run, setShared, shared, theme, writeTextFile } from "herdr";
import { emptyRule, THINKING_LEVELS, validatePolicy } from "./core/policy.js";
import { summarize, thinkingSuffix, toggleModel } from "./core/selection.js";
import { Dropdown } from "./dropdown.js";

const MOD = "pi-routing";
const PANEL_ID = "routing";
const TAB_KEY = "routing-tab";

// ---------------------------------------------------------------- helpers

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function panelSelected() {
  const root = layout();
  return !findNode(root, "panel")?.hidden && findNode(root, "panel-body")?.active === PANEL_ID;
}

function togglePanel() {
  if (!findNode(layout(), "panel-body")?.children?.some((node) => node.id === PANEL_ID)) {
    notify({
      title: "Routing is not in this layout",
      body: "Run the installer on this personal layout to add it to the right panel.",
      level: "error",
    });
    return;
  }
  if (panelSelected()) run("layout.hide", { id: "panel" });
  else {
    run("layout.select", { stack: "panel-body", child: PANEL_ID });
    run("layout.show", { id: "panel" });
    // The panel view is retained while hidden, so its init-time read goes
    // stale. Asking it to reload here makes every opening read the current
    // policy without clearing an unsaved draft.
    run("pi-routing.reload");
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The wide-then-narrow id of a model row, as Pi writes it. */
function modelKey(model) {
  return `${model.provider}/${model.id}`;
}

function actionButton(t, id, label, action, tone, accessibility = label, focus = null) {
  const button = Button.new(id)
    .accessibility_label(accessibility)
    .flex_none()
    .h(26)
    .px(9)
    .items_center()
    .rounded(6)
    .text_size(12)
    .text_color(tone === "primary" ? t.solid_foreground : t.foreground)
    .bg(tone === "primary" ? t.solid : t.background)
    .border(1)
    .border_color(tone === "primary" ? t.solid : t.border)
    .hover((style) => (tone === "primary" ? style.opacity(0.9) : style.bg(t.hover)))
    .focus((style) => style.border_color(t.accent))
    .tab_stop(true)
    .on_mouse_down("left", (_event, inner) => inner.stop_propagation())
    .on_click((_event, inner) => {
      inner.stop_propagation();
      action(inner);
    })
    .child(label);
  return focus ? button.track_focus(focus) : button;
}

/** The stored shape is trimmed by the host, so a saved rule and its draft match after a trim. */
function sameRule(a, b) {
  return (
    a.model.trim() === b.model.trim() &&
    a.when.trim() === b.when.trim() &&
    a.thinking === b.thinking &&
    (a.fast ?? "off") === (b.fast ?? "off")
  );
}

function emptyRow(t, text) {
  return div().py(14).text_size(12).text_color(t.dim).child(text);
}

function groupLabel(t, text) {
  return div().pt(6).pb(4).text_size(10).text_color(t.dim).child(text);
}

export default class Routing extends View {
  init(_props, cx) {
    this.slot = props()?.slot ?? "bar";
    this.handle = cx.focus_handle();
    this.tabFocus = [cx.focus_handle(), cx.focus_handle()];
    this.width = 368;
    if (this.slot === "bar") {
      // Native tabs owns per-space restoration; add Routing without replacing
      // the person's enabled Files/Changes entries.
      const stored = shared("workspace.panels");
      const panels = Array.isArray(stored) ? stored : ["files", "changes"];
      if (!panels.includes(PANEL_ID)) setShared("workspace.panels", [...panels, PANEL_ID]);
      return;
    }
    this.tab = localStorage.getItem(TAB_KEY) === "rules" ? "rules" : "models";
    this.hovered = false;
    this.search = InputState.new({ placeholder: "Search provider or model" });
    this.search.on("change", (_event, inner) => inner.notify());
    this.loading = true;
    this.loadError = "";
    this.snapshot = null;
    this.modelsDraft = null;
    this.rulesDraft = null;
    // The one rule the dedicated editor is showing, plus the not-yet-saved rule
    // `+ Add rule` created. Back closes the screen; both stay here, so reopening
    // restores the text instead of leaving a blank card or losing it.
    this.editor = null;
    this.pendingNew = null;
    this.when = null;
    this.ruleFocus = new Map();
    this.addFocus = cx.focus_handle();
    this.error = "";
    this.saved = false;
    this.saving = false;
    this.modelMenu = new Dropdown("rule-model", "Model", cx, {
      searchable: true,
      placeholder: "Search provider or model",
      searchLabel: "Search models",
    });
    this.thinkingMenu = new Dropdown("rule-thinking", "Thinking", cx);
    this.reload(cx);
    // The bar sends this when it opens Routing. This task owns the context
    // used by the host read, so the refresh works even though the panel view
    // itself is retained across hide/show.
    cx.spawn(async (task) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "reload") this.reload(task);
      }
    });
  }

  // ---------------------------------------------------------------- the host

  async hostConfig() {
    if (!this.host) {
      const info = parse(await readTextFile(`${appHome()}/mods/${MOD}/host.json`));
      if (typeof info?.command !== "string" || !Array.isArray(info.args)) {
        throw new Error("Reinstall Routing to restore its Pi host command.");
      }
      this.host = info;
    }
    return this.host;
  }

  /** One JSON reply from the package's host command. */
  async hostReply(args) {
    const host = await this.hostConfig();
    const result = await exec(host.command, [...host.args, ...args, "--json"]);
    const reply = parse(result.stdout);
    if (!reply || typeof reply !== "object") {
      const detail = String(result.stderr ?? "").trim().split("\n")[0];
      throw new Error(detail || `The Routing host exited ${result.code}.`);
    }
    return reply;
  }

  /** Write a draft inside the app home for the host command to pick up. */
  async writeDraft(name, value) {
    const path = `${appHome()}/data/${MOD}/${name}`;
    const current = await readTextFile(path).catch(() => null);
    await writeTextFile(path, JSON.stringify(value, null, 2), current);
    return path;
  }

  /** Reads Pi and the policy. It touches no context, so an `await` cannot stale one; the caller notifies. */
  async load() {
    this.loading = true;
    this.loadError = "";
    try {
      const snapshot = await this.hostReply(["snapshot"]);
      this.snapshot = snapshot;
      this.saved = false;
    } catch (error) {
      this.loadError = message(error);
    } finally {
      this.loading = false;
    }
  }

  /** A read started from `init` or a handler: the task's context is valid across its awaits. */
  reload(cx) {
    cx.spawn(async (task) => {
      await this.load();
      this.syncRuleFocus(task);
      task.notify();
    });
  }

  // ------------------------------------------------------------ draft state

  get models() {
    return this.snapshot?.models?.ok ? this.snapshot.models : null;
  }

  get policy() {
    return this.snapshot?.policy?.ok ? this.snapshot.policy : null;
  }

  get committedPatterns() {
    return this.models?.selection.entries ?? [];
  }

  get committedRules() {
    return this.policy?.rules ?? [];
  }

  get draftPatterns() {
    return this.modelsDraft ?? this.committedPatterns;
  }

  get draftRules() {
    return this.rulesDraft?.rules ?? this.committedRules;
  }

  /** What every stored or staged entry switches on: Pi's answer for stored
   *  entries, and the id itself for the exact entries a toggle creates. */
  view() {
    const models = this.models;
    if (!models) return { entries: [], resolution: [], available: [] };
    const known = new Map(models.selection.resolution.map((entry) => [entry.pattern, entry.keys]));
    const available = models.available.map(modelKey);
    const index = new Set(available);
    const entries = this.draftPatterns;
    const resolution = entries.map((pattern) => {
      const resolved = known.get(pattern);
      if (resolved) return { pattern, keys: resolved };
      const suffix = thinkingSuffix(pattern);
      const base = suffix ? pattern.slice(0, -(suffix.length + 1)) : pattern;
      return { pattern, keys: index.has(base) ? [base] : [] };
    });
    return { entries, resolution, available };
  }

  dirty() {
    if (this.tab === "models") return this.modelsDraft !== null && !sameList(this.modelsDraft, this.committedPatterns);
    if (this.rulesDraft === null) return false;
    return JSON.stringify(this.rulesDraft.rules) !== JSON.stringify(this.committedRules);
  }

  setTab(tab, cx) {
    if (this.tab === tab) return;
    this.tab = tab;
    this.error = "";
    this.modelMenu.open = false;
    this.thinkingMenu.open = false;
    localStorage.setItem(TAB_KEY, tab);
    cx.notify();
  }

  toggleModel(key, on, cx) {
    const next = toggleModel(this.view(), key, on);
    this.saved = false;
    this.error = "";
    this.modelsDraft = sameList(next, this.committedPatterns) ? null : next;
    cx.notify();
  }

  discard(cx) {
    if (this.saving) return;
    if (this.tab === "models") this.modelsDraft = null;
    else {
      // Rules-tab scope only: a Models draft is left exactly as it is.
      this.rulesDraft = null;
      this.pendingNew = null;
      this.editor = null;
      this.when = null;
      this.modelMenu.open = false;
      this.thinkingMenu.open = false;
      this.addFocus.focus();
    }
    this.error = "";
    this.saved = false;
    cx.notify();
  }

  save(cx) {
    if (this.saving) return;
    if (this.tab === "models" ? !this.models : !this.policy) return;
    // Capture exactly what this press writes before starting the task: a reset
    // while it runs must not change the payload, and the editor is validated
    // here so an invalid rule never reaches the host.
    const tab = this.tab;
    let payload;
    if (tab === "models") {
      payload = { patterns: [...this.draftPatterns] };
    } else {
      const checked = validatePolicy({ rules: this.draftRules, notes: this.policy.notes });
      if (checked.error) {
        if (this.editor) this.editor.error = checked.error;
        else this.error = checked.error;
        cx.notify();
        return;
      }
      payload = checked.policy;
    }
    const savedRule = this.editor?.rule ?? null;
    const wasNew = this.editor?.isNew ?? false;
    this.saving = true;
    this.error = "";
    if (this.editor) this.editor.error = "";
    // A handler's context ends when it returns, so only this first render uses
    // it: the save itself runs as a task, whose context stays valid across the
    // `await`s that write the draft, run the host command and reload.
    cx.notify();
    cx.spawn(async (task) => {
      try {
        if (tab === "models") {
          const path = await this.writeDraft("draft-models.json", payload);
          const reply = await this.hostReply(["save-models", "--draft", path, "--expect", this.models.selection.hash ?? "none"]);
          if (!reply.ok) throw new Error(reply.error || "Pi's settings could not be saved.");
        } else {
          const path = await this.writeDraft("draft-policy.json", payload);
          const reply = await this.hostReply(["save-policy", "--draft", path]);
          if (!reply.ok) throw new Error(reply.error || "The policy skill could not be saved.");
        }
        // Only a host-confirmed write clears a draft. A refused save above leaves
        // every field and the whole Rules draft exactly as it was, so a retry
        // writes the same rule once and can never append it twice.
        if (tab === "models") this.modelsDraft = null;
        else {
          this.rulesDraft = null;
          this.pendingNew = null;
          this.closeEditor(task, { focus: false });
        }
        await this.load();
        this.syncRuleFocus(task);
        this.saved = true;
        this.error = "";
        if (tab === "rules") this.focusAfterSave(savedRule, wasNew);
      } catch (error) {
        // The draft stays exactly as it is, so a failed save never loses edits.
        this.error = message(error);
      } finally {
        this.saving = false;
        task.notify();
      }
    });
  }

  // ----------------------------------------------------------- rule editing

  /** `+ Add rule` and a rule card both land on the dedicated editor screen. */
  startEdit(cx, index) {
    const existing = index >= 0 ? this.draftRules[index] : null;
    let rule;
    if (existing) {
      // Clone the loaded rule until the first real change, so the snapshot
      // `Discard` restores is never mutated by typing.
      rule = this.rulesDraft?.rules.includes(existing) ? existing : { ...existing };
    } else {
      rule = this.pendingNew ?? emptyRule();
    }
    this.editor = { index, isNew: index < 0, rule, error: "" };
    // No `rows`: the padded frame owns the height and scrolling. A rows minimum
    // taller than the frame's content box is what clipped the last line before.
    const when = TextareaState.new({ value: rule.when, placeholder: "When this model should be used" });
    this.when = when;
    when.on("change", (_event, inner) => {
      if (this.editor?.rule !== rule) return;
      rule.when = when.value();
      this.stageEditor(inner);
      this.saved = false;
      inner.notify();
    });
    this.error = "";
    this.saved = false;
    this.modelMenu.open = false;
    this.thinkingMenu.open = false;
    this.ensureRuleFocus(cx, rule);
    this.when.focus();
    cx.notify();
  }

  /** A focus handle for a card or the editor, made in a handler, never in render. */
  ensureRuleFocus(cx, rule) {
    let handle = this.ruleFocus.get(rule);
    if (!handle) {
      handle = cx.focus_handle();
      this.ruleFocus.set(rule, handle);
    }
    return handle;
  }

  /** The editor's rule joins the tab draft on the first change, so Save sees it. */
  stageEditor(cx) {
    if (!this.editor) return;
    const rule = this.editor.rule;
    const rules = this.rulesDraft?.rules ?? this.committedRules;
    if (rules.includes(rule)) return;
    const next = [...rules];
    if (this.editor.isNew) next.push(rule);
    else next[this.editor.index] = rule;
    this.rulesDraft = { rules: next, notes: this.policy?.notes ?? [] };
    if (this.editor.isNew) this.pendingNew = rule;
    this.ensureRuleFocus(cx, rule);
  }

  /** Back, Escape and a confirmed save all leave the dedicated screen. */
  closeEditor(cx, { focus = true } = {}) {
    const editor = this.editor;
    this.editor = null;
    this.when = null;
    this.modelMenu.open = false;
    this.thinkingMenu.open = false;
    if (editor && focus) {
      const handle = editor.isNew ? this.addFocus : this.ruleFocus.get(editor.rule);
      (handle ?? this.tabFocus[1]).focus();
    }
    cx.notify();
  }

  removeRule(cx) {
    const editor = this.editor;
    if (!editor || editor.isNew) return;
    const rules = this.draftRules.filter((_rule, index) => index !== editor.index);
    this.rulesDraft = { rules, notes: this.policy?.notes ?? [] };
    this.ruleFocus.delete(editor.rule);
    this.error = "";
    this.saved = false;
    this.closeEditor(cx);
    cx.notify();
  }

  /** Focus handles follow the visible draft; rebuilt in a task, never in render. */
  syncRuleFocus(cx) {
    const next = new Map();
    for (const rule of this.draftRules) next.set(rule, this.ruleFocus.get(rule) ?? cx.focus_handle());
    this.ruleFocus = next;
  }

  focusAfterSave(savedRule, wasNew) {
    if (wasNew || !savedRule) {
      this.addFocus.focus();
      return;
    }
    const match = this.committedRules.find((rule) => sameRule(rule, savedRule));
    const handle = match ? this.ruleFocus.get(match) : null;
    (handle ?? this.tabFocus[1]).focus();
  }

  // ---------------------------------------------------------------- render

  renderBar(cx) {
    const t = theme();
    const selected = panelSelected();
    const lit = selected || this.hovered;
    return h_flex()
      .id("routing-bar")
      .size_full()
      .min_w(0)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .on_mouse_down("left", (_event, inner) => inner.stop_propagation())
      .child(
        h_flex()
          .id("routing-open")
          .relative()
          .h(26)
          // The slot is tight to the content on purpose, and the highlighted
          // pill is drawn behind it with a little overhang, so the button lines
          // up with the tab bar's buttons without a cramped pill. See
          // `renderBarSlot` notes in the package README: the layout's
          // `routing-bar` px is the sum of these paddings and the content.
          .pl(1)
          .pr(3)
          .gap(5)
          .items_center()
          .min_w(0)
          .text_color(selected ? t.foreground : t.muted)
          .text_size(12)
          .on_mouse_down("left", (_event, inner) => inner.stop_propagation())
          .on_hover((hovered, inner) => {
            if (this.hovered === hovered) return;
            this.hovered = hovered;
            inner.notify();
          })
          .on_click(() => togglePanel())
          .when(lit, (el) =>
            el.child(
              div()
                .absolute()
                .left(-7)
                .right(-5)
                .top(0)
                .bottom(0)
                .rounded(6)
                .bg(selected ? t.selected : t.hover),
            ),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(svg(`mods/${MOD}/route.svg`).size(14))
              .child(div().child("Routing")),
          ),
      );
  }

  tabs(t, cx) {
    const tabs = [
      ["models", "Models"],
      ["rules", "Rules"],
    ];
    return h_flex()
      .id("routing-tabs")
      .h(50)
      .flex_none()
      .px(12)
      .gap(6)
      .items_center()
      .justify_center()
      .border_b(1)
      .border_color(t.border)
      .role("tab_list")
      .accessibility_label("Routing sections")
      .children(
        tabs.map(([id, label], index) => {
          const selected = this.tab === id;
          return Button.new(`routing-tab-${id}`)
            .h(30)
            .px(10)
            .flex_none()
            .items_center()
            .rounded(6)
            .role("tab")
            .selected(selected)
            .set_position(index + 1, tabs.length)
            .accessibility_label(label)
            .text_size(12)
            .bg(selected ? t.selection : t.background)
            .text_color(selected ? t.foreground : t.muted)
            .track_focus(this.tabFocus[index])
            .tab_stop(true)
            .hover((style) => style.text_color(t.foreground))
            .focus((style) => style.border(1).border_color(t.accent))
            .on_mouse_down("left", (_event, inner) => inner.stop_propagation())
            .on_click((_event, inner) => this.setTab(id, inner))
            .on_key_down((event, inner) => {
              if (!["left", "right", "home", "end"].includes(event.key)) return;
              const next = event.key === "home" ? 0 : event.key === "end" ? tabs.length - 1 : (index + 1) % tabs.length;
              const target = tabs[next];
              if (target) this.setTab(target[0], inner);
              this.tabFocus[next]?.focus();
              inner.stop_propagation();
            })
            .child(label);
        }),
      );
  }

  modelsView(t, cx) {
    const models = this.models;
    if (!models) return this.notice(t, cx, "models");
    const view = this.view();
    const summary = summarize(view);
    const enabled = new Set(view.resolution.flatMap((entry) => entry.keys));
    const query = this.search.value().trim().toLowerCase();
    const text = (value) => !query || value.toLowerCase().includes(query);
    const matches = (model) => text(modelKey(model)) || text(model.name);
    const on = models.available.filter((model) => enabled.has(modelKey(model)) && matches(model));
    const off = models.available.filter((model) => !enabled.has(modelKey(model)) && matches(model));
    // A saved entry Pi resolves to nothing has no catalogue row of its own. It
    // stays in Pi's settings, so the list shows it where it belongs instead of
    // warning about it above the list.
    const missing = [...new Set(summary.unmatched)].filter(text);
    const box = (checked) =>
      div()
        .flex_none()
        .size(16)
        .rounded(3)
        .border(1)
        .border_color(checked ? t.accent : t.input)
        .bg(t.background)
        .text_size(11)
        .text_color(t.accent)
        .flex()
        .items_center()
        .justify_center()
        .child(checked ? "✓" : "");
    const row = (model) => {
      const key = modelKey(model);
      const checked = enabled.has(key);
      return Checkbox.new(`model-${key}`)
        .checked(checked)
        .accessibility_label(`${key}, ${checked ? "included" : "not included"}`)
        .tab_stop(true)
        .w_full()
        .h_flex()
        .py(11)
        .gap(10)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .hover((style) => style.bg(t.hover))
        .focus((style) => style.bg(t.selected))
        .on_change((next, inner) => this.toggleModel(key, next, inner))
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(div().text_size(13).truncate().child(model.id))
            .child(div().text_size(11).text_color(t.muted).truncate().child(model.provider)),
        )
        .child(box(checked));
    };
    const savedRow = (pattern) =>
      Checkbox.new(`model-saved-${pattern}`)
        .checked(true)
        .accessibility_label(`${pattern}, not in Pi's catalogue, included`)
        .tab_stop(true)
        .w_full()
        .h_flex()
        .py(11)
        .gap(10)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .hover((style) => style.bg(t.hover))
        .focus((style) => style.bg(t.selected))
        .on_change((next, inner) => this.toggleModel(pattern, next, inner))
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(div().text_size(13).truncate().child(pattern))
            .child(div().text_size(11).text_color(t.muted).truncate().child("not in Pi's catalogue")),
        )
        .child(box(true));
    // Pi can answer with no catalogue at all: say that once, instead of two
    // groups whose empty lines would each claim the same thing.
    if (models.available.length === 0) {
      return v_flex()
        .id("routing-models")
        .flex_1()
        .min_h(0)
        .min_w(0)
        .px(12)
        .py(12)
        .gap(10)
        .child(
          h_flex()
            .items_center()
            .justify_between()
            .child(div().font_semibold().child("Models"))
            .child(div().text_size(11).text_color(t.muted).role("status").child("No models available")),
        )
        .child(emptyRow(t, "No models are available to Pi right now."));
    }
    return v_flex()
      .id("routing-models")
      .flex_1()
      .min_h(0)
      .min_w(0)
      .overflow_y_scrollbar()
      .px(12)
      .py(12)
      .gap(10)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(div().font_semibold().child("Models"))
          .child(div().text_size(11).text_color(t.muted).role("status").child(summary.all ? `All ${summary.available} models` : `${summary.enabled} enabled`)),
      )
      .child(
        h_flex()
          .h(32)
          .w_full()
          .px(9)
          .gap(7)
          .items_center()
          .rounded(6)
          .border(1)
          .border_color(t.input)
          .bg(t.background)
          .child(svg(`mods/${MOD}/search.svg`).size(13).flex_none().text_color(t.muted))
          .child(Input.new(this.search).flex_1().min_w(0).text_size(12).accessibility_label("Search provider or model")),
      )
      .child(div().text_size(11).text_color(t.dim).child("Select models to include in the enabled list."))
      .when(this.modelsDraft?.length === 0, (el) =>
        el.child(div().text_size(11).text_color(t.ansi3).role("status").child("An empty list enables every model in Pi.")),
      )
      .child(groupLabel(t, "ENABLED"))
      .when(on.length === 0 && missing.length === 0, (el) =>
        el.child(emptyRow(t, query ? "No enabled model matches this search." : "No saved entry matches a model in Pi's catalogue.")),
      )
      .children(on.map(row))
      .children(missing.map(savedRow))
      .child(groupLabel(t, "CATALOG"))
      .when(off.length === 0, (el) => el.child(emptyRow(t, query ? "No other model matches this search." : "Every available model is enabled.")))
      .children(off.map(row));
  }

  rulesView(t, cx) {
    if (!this.policy) return this.notice(t, cx, "policy");
    if (this.editor) return this.editorScreen(t, cx);
    const rules = this.draftRules;
    const card = (rule, index) => {
      const focus = this.ruleFocus.get(rule);
      const button = Button.new(`rule-${index}`)
        .w_full()
        .flex_none()
        .flex_col()
        .items_start()
        .gap(6)
        .p(12)
        .rounded(6)
        .border(1)
        .border_color(t.border)
        .bg(t.popover)
        .text_color(t.foreground)
        .accessibility_label(`Edit rule: ${rule.when || "no description yet"}`)
        .tab_stop(true)
        .hover((style) => style.border_color(t.input))
        .focus((style) => style.border_color(t.accent))
        .on_click((_event, inner) => this.startEdit(inner, index))
        .child(div().text_size(12.5).text_left().child(rule.when || "No description yet"))
        .child(
          div()
            .text_size(11)
            .text_color(t.muted)
            .text_left()
            .child(`${rule.model || "No model yet"} · ${rule.thinking}${rule.fast && rule.fast !== "off" ? ` · fast ${rule.fast}` : ""}`),
        );
      return focus ? button.track_focus(focus) : button;
    };
    return v_flex()
      .id("routing-rules")
      .flex_1()
      .min_h(0)
      .min_w(0)
      .overflow_y_scrollbar()
      .px(12)
      .py(12)
      .gap(10)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(div().font_semibold().child("Rules"))
          .child(
            actionButton(
              t,
              "rule-add",
              "+ Add rule",
              (inner) => {
                if (!this.editor && !this.saving) this.startEdit(inner, -1);
              },
              undefined,
              "Add rule",
              this.addFocus,
            ),
          ),
      )
      .when(rules.length === 0, (el) => el.child(emptyRow(t, "No rules yet. Add one to describe which model does what.")))
      .children(rules.map(card))
      .when(this.policy.notes.length > 0, (el) =>
        el.child(div().pt(4).text_size(11).text_color(t.dim).child("Precedence and exception notes stay as they are in the skill.")),
      );
  }

  /** The dedicated editor: Back, fields, and no inner commit/reset controls. */
  editorScreen(t, cx) {
    const editor = this.editor;
    const rule = editor.rule;
    const modelOptions = (this.models?.available ?? []).map((model) => ({
      value: modelKey(model),
      label: modelKey(model),
      detail: model.name,
    }));
    if (rule.model && !modelOptions.some((option) => option.value === rule.model)) {
      modelOptions.unshift({ value: rule.model, label: rule.model, detail: "not in the catalogue" });
    }
    this.modelMenu.valueLabel = rule.model || "Select a model";
    this.modelMenu.menuWidth = Math.max(220, Math.min(320, this.width - 74));
    this.thinkingMenu.valueLabel = rule.thinking;
    this.thinkingMenu.menuWidth = Math.max(160, Math.min(240, this.width - 74));
    const field = (label, control) =>
      v_flex()
        .gap(5)
        .child(div().text_size(11).text_color(t.muted).child(label))
        .child(control);
    const choose = (key, value, inner) => {
      rule[key] = value;
      editor.error = "";
      this.stageEditor(inner);
      this.saved = false;
      inner.notify();
    };
    return v_flex()
      .id("routing-rule-editor")
      .flex_1()
      .min_h(0)
      .min_w(0)
      .child(
        h_flex()
          .h(50)
          .flex_none()
          .px(12)
          .gap(10)
          .items_center()
          .child(actionButton(t, "rule-back", "‹ Back", (inner) => this.closeEditor(inner), undefined, "Back"))
          .child(div().text_size(13).font_semibold().child(editor.isNew ? "New rule" : "Edit rule"))
          .when(!editor.isNew, (el) =>
            el.child(div().flex_1()).child(actionButton(t, "rule-remove", "Remove", (inner) => this.removeRule(inner))),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .min_w(0)
          .overflow_y_scrollbar()
          .px(12)
          .pb(12)
          .gap(12)
          .child(
            field(
              "Model",
              this.modelMenu.render(t, rule.model, modelOptions, (value, inner) => choose("model", value, inner)),
            ),
          )
          .child(
            field(
              "When to use",
              Textarea.new(this.when)
                .h(160)
                .w_full()
                .min_h(0)
                .min_w(0)
                .px(9)
                .py(7)
                .rounded(6)
                .border(1)
                .border_color(t.input)
                .focus((style) => style.border_color(t.accent))
                .bg(t.background)
                .text_size(12)
                .text_color(t.foreground)
                .accessibility_label("When to use"),
            ),
          )
          .child(
            field(
              "Thinking",
              this.thinkingMenu.render(
                t,
                rule.thinking,
                THINKING_LEVELS.map((level) => ({ value: level, label: level })),
                (value, inner) => choose("thinking", value, inner),
              ),
            ),
          )
          .when(Boolean(editor.error), (el) => el.child(div().text_size(11).text_color(t.blocked).role("alert").child(editor.error))),
      );
  }

  /** Loading, a read error, or the tab's own data being unreadable. */
  notice(t, cx, section) {
    if (this.loading) {
      return v_flex().flex_1().min_h(0).p(12).child(emptyRow(t, "Reading Pi and the routing policy…"));
    }
    const error = this.loadError || (section === "models" ? this.snapshot?.models?.error : this.snapshot?.policy?.error) || "";
    return v_flex()
      .flex_1()
      .min_h(0)
      .p(12)
      .gap(10)
      .role("alert")
      .child(div().text_size(12).text_color(t.blocked).child(error || "Nothing to show."))
      .child(actionButton(t, `routing-retry-${section}`, "Retry", (inner) => this.reload(inner)));
  }

  footer(t, cx) {
    const dirty = this.dirty();
    const usable = this.tab === "models" ? Boolean(this.models) : Boolean(this.policy);
    return v_flex()
      .flex_none()
      .w_full()
      .border_t(1)
      .border_color(t.border)
      .px(12)
      .py(10)
      .gap(6)
      .when(Boolean(this.error), (el) => el.child(div().text_size(11).text_color(t.blocked).role("alert").child(this.error)))
      .child(
        h_flex()
          .w_full()
          .items_center()
          .justify_between()
          .child(div().text_size(11).text_color(dirty ? t.ansi3 : t.muted).role("status").child(dirty ? "Draft changes" : this.saved ? "Saved" : ""))
          .child(
            h_flex()
              .gap(7)
              .child(
                actionButton(t, "routing-discard", "Discard", (inner) => this.discard(inner)),
              )
              .child(
                Button.new("routing-save")
                  .flex_none()
                  .h(26)
                  .px(11)
                  .items_center()
                  .rounded(6)
                  .text_size(12)
                  .bg(t.solid)
                  .text_color(t.solid_foreground)
                  .disabled(!dirty || this.saving || !usable)
                  .accessibility_label("Save")
                  .tab_stop(true)
                  .hover((style) => style.opacity(0.9))
                  .focus((style) => style.border(1).border_color(t.accent))
                  .on_mouse_down("left", (_event, inner) => inner.stop_propagation())
                  .on_click((_event, inner) => this.save(inner))
                  .child(this.saving ? "Saving…" : "Save"),
              ),
          ),
      );
  }

  render(cx) {
    if (this.slot === "bar") return this.renderBar(cx);
    const t = theme();
    return v_flex()
      .id("routing-panel")
      .size_full()
      .min_h(0)
      .min_w(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .on_size_change((size, inner) => {
        if (this.width !== size.width) {
          this.width = size.width;
          inner.notify();
        }
      })
      .track_focus(this.handle)
      .on_key_down((event, inner) => {
        // Escape leaves the screen the way Back does: it never discards text.
        if (event.key !== "escape" || !this.editor) return;
        this.closeEditor(inner);
        inner.stop_propagation();
      })
      .child(this.tabs(t, cx))
      .child(this.loading || this.loadError ? this.notice(t, cx, this.tab) : this.tab === "models" ? this.modelsView(t, cx) : this.rulesView(t, cx))
      .child(this.footer(t, cx));
  }
}
