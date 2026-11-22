// Installed as the entry point of a personal clone of the current pane header.
// base.js and its assets come from Herdr's official mod.clone, never a shipped-file edit.
import BaseHeader from "./base.js";
import { div } from "gpui-kit";
import { Button, h_flex, Popup, Select, v_flex } from "gpui-base";
import { panes, props, run, setShared, shared, theme } from "herdr";

// Stored task statuses only; "Running" is derived from an active task with a live source, so it
// belongs to Active. Works have no status and are never filtered by value.
const STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export default class TasksHeader extends BaseHeader {
  init(props, cx) {
    super.init?.(props, cx);
    this.activityFocus = [cx.focus_handle(), cx.focus_handle()];
    this.statusIndex = 0;
    this.statusTrigger = cx.focus_handle();
    this.statusContent = cx.focus_handle();
  }

  activityHeader(id) {
    const t = theme();
    const key = "pi-activity-section:" + id;
    const selected = shared(key) === "monitors" ? "monitors" : "loops";
    const sections = ["loops", "monitors"];
    const select = (index) => {
      const target = panes().find((item) => item.pane === id);
      if (target?.mod !== "pi-loop-monitor" || target.terminal !== null) return;
      run("pane.focus", { pane: id });
      setShared(key, sections[index]);
      this.activityFocus[index].focus();
    };
    return h_flex().id("activity-header-" + id).size_full().px(10).gap(12).items_center()
      .bg(t.background).border_b(1).border_color(t.border).text_size(12)
      .child(h_flex().h_full().gap(12).role("tab_list").accessibility_label("Loops and Monitors sections")
        .children(sections.map((section, index) => Button.new("activity-tab-" + id + section)
          .h_full().px(4).role("tab").selected(selected === section).set_position(index + 1, 2)
          .track_focus(this.activityFocus[index]).tab_stop(selected === section)
          .text_color(selected === section ? t.foreground : t.dim)
          .when(selected === section, (style) => style.font_semibold().border_b(2).border_color(t.accent))
          .hover((style) => style.bg(t.hover)).focus((style) => style.bg(t.selected))
          .accessibility_label(section === "loops" ? "Loops" : "Monitors")
          .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
          .on_click((_event, cx) => { cx.stop_propagation(); select(index); })
          .on_key_down((event, cx) => {
            if (!["left", "right", "home", "end"].includes(event.key)) return;
            cx.stop_propagation();
            const next = event.key === "home" ? 0 : event.key === "end" ? 1 : 1 - index;
            select(next);
          }).child(section === "loops" ? "Loops" : "Monitors"))))
      .child(div().flex_1())
      .child(Button.new("activity-close-" + id).size(30).flex_none().rounded(4).cursor_pointer()
        .text_size(22).text_color(t.muted).hover((style) => style.bg(t.hover).text_color(t.foreground))
        .focus((style) => style.bg(t.selected).text_color(t.accent)).tab_stop(true)
        .accessibility_label("Close Loops and Monitors view").tooltip("Close only this view; Tasks, Pi, loops and monitors continue")
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click((_event, cx) => {
          cx.stop_propagation();
          const target = panes().find((item) => item.pane === id);
          if (target?.mod === "pi-loop-monitor" && target.terminal === null) run("pane.close", { pane: id });
        }).child("×"));
  }

  // The content copy cannot name its own pane, so this pane's header publishes the selected status
  // under a pane-scoped key; the Tasks view reads the same key through the pane id it is given.
  statusKey(id) {
    return "pi-tasks-status:" + id;
  }

  statusValue(id) {
    const value = shared(this.statusKey(id));
    return STATUSES.some((item) => item.value === value) ? value : "all";
  }

  // Open state is shared with this pane's view, which closes the menu when the pointer goes down
  // anywhere in the task list: Herdr's Select owns Escape and its own dismissal, but a click
  // outside this mod never reaches it.
  statusOpenKey(id) {
    return "pi-tasks-status-open:" + id;
  }

  statusOpen(id) {
    return shared(this.statusOpenKey(id)) === true;
  }

  setStatusOpen(id, open) {
    setShared(this.statusOpenKey(id), open);
  }

  statusControl(id, t) {
    const value = this.statusValue(id);
    const current = STATUSES.find((item) => item.value === value) ?? STATUSES[0];
    const open = this.statusOpen(id);
    const choose = (entry, cx) => {
      setShared(this.statusKey(id), entry.value);
      this.setStatusOpen(id, false);
      this.statusIndex = Math.max(0, STATUSES.findIndex((item) => item.value === entry.value));
      this.statusTrigger.focus();
      cx.notify();
    };
    const close = (cx) => {
      this.setStatusOpen(id, false);
      this.statusTrigger.focus();
      cx.notify();
    };
    const trigger = h_flex().id("tasks-status-trigger-" + id).h(26).w(120).flex_none().min_w(0).px(8).gap(4).items_center()
      .bg(t.background).rounded(6).border(1).border_color(t.input)
      .track_focus(this.statusTrigger).tab_index(0).cursor_pointer()
      .accessibility_label("Task status: " + current.label).tooltip("Show only tasks with one status")
      .focus((style) => style.border_color(t.accent))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => {
        cx.stop_propagation();
        const next = !this.statusOpen(id);
        this.setStatusOpen(id, next);
        if (next) this.statusIndex = Math.max(0, STATUSES.findIndex((item) => item.value === value));
        (next ? this.statusContent : this.statusTrigger).focus();
        cx.notify();
      })
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(current.label))
      .child(div().flex_none().text_size(11).text_color(t.muted).child("⌄"));
    // Anchoring to the trigger and growing down-right is the one placement this 32px pane header
    // supports: an anchor above the trigger would land outside the window.
    const menu = v_flex().id("tasks-status-menu-" + id).w(190).min_w(0).p(5).gap(1).rounded(6)
      .border(1).border_color(t.input).bg(t.popover).text_color(t.foreground)
      .track_focus(this.statusContent).role("list_box").accessibility_label("Task status")
      .on_key_down((event, cx) => {
        if (event.key === "up" || event.key === "down") {
          const step = event.key === "down" ? 1 : -1;
          this.statusIndex = (this.statusIndex + step + STATUSES.length) % STATUSES.length;
          cx.stop_propagation(); cx.notify();
        } else if (event.key === "enter" || event.key === "return") {
          choose(STATUSES[this.statusIndex], cx); cx.stop_propagation();
        } else if (event.key === "escape") {
          close(cx); cx.stop_propagation();
        }
      })
      .children(STATUSES.map((entry, index) => h_flex().id("tasks-status-option-" + id + entry.value).h(30).flex_none().min_w(0).px(6).gap(6).items_center()
        .rounded(4).role("list_box_option").accessibility_label(entry.label).selected(entry.value === value)
        .when(index === this.statusIndex, (row) => row.aria_active_descendant())
        .bg(index === this.statusIndex ? t.selected : t.popover).hover((style) => style.bg(t.hover))
        .cursor_pointer()
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click((_event, cx) => { cx.stop_propagation(); choose(entry, cx); })
        .child(div().w(12).flex_none().text_size(12).text_color(t.foreground).child(entry.value === value ? "✓" : ""))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(entry.label))));
    const select = Select.new("tasks-status-" + id).accessibility_label("Task status").open(open)
      .track_focus(this.statusTrigger).content_focus_handle(this.statusContent)
      .on_open_change((next, cx) => {
        this.setStatusOpen(id, next);
        if (next) this.statusIndex = Math.max(0, STATUSES.findIndex((item) => item.value === value));
        cx.notify();
      })
      .on_confirm((_event, cx) => choose(STATUSES[this.statusIndex], cx))
      .on_dismiss((_event, cx) => close(cx))
      .child(Popup.new("tasks-status-popup-" + id, trigger).anchor("bottom_right")
        .when(open, (el) => el.content(menu)));
    return select;
  }

  render(cx) {
    const id = props()?.pane;
    const pane = panes().find((item) => item.pane === id);
    if (pane?.mod === "pi-loop-monitor" && pane.terminal === null) return this.activityHeader(id);
    if (pane?.mod !== "pi-tasks" || pane.terminal !== null) return super.render(cx);
    const t = theme();
    return h_flex().id("tasks-header-" + id).size_full().px(10).items_center().gap(8)
      .bg(t.background).border_b(1).border_color(t.border).text_size(12)
      .on_click(() => {
        if (this.statusOpen(id)) this.setStatusOpen(id, false);
        run("pane.focus", { pane: id });
      })
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child("Tasks"))
      .child(this.statusControl(id, t))
      .child(Button.new("tasks-close-" + id).size(32).flex_none().rounded(4).cursor_pointer()
        .text_size(22).text_color(t.muted).hover((style) => style.bg(t.hover).text_color(t.foreground))
        .focus((style) => style.bg(t.selected).text_color(t.accent))
        .accessibility_label("Close Tasks view").tooltip("Close Tasks only; Pi, agents and tracking continue").tab_stop(true)
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click((_event, cx) => {
          cx.stop_propagation();
          const target = panes().find((item) => item.pane === id);
          if (target?.mod === "pi-tasks" && target.terminal === null) run("pane.close", { pane: id });
        }).child("×"));
  }
}
