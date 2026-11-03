// Installed as the entry point of a personal clone of the current pane header.
// base.js and its assets come from Herdr's official mod.clone, never a shipped-file edit.
import BaseHeader from "./base.js";
import { div } from "gpui-kit";
import { Button, h_flex } from "gpui-base";
import { panes, props, run, shared, setShared, theme } from "herdr";

export default class TasksHeader extends BaseHeader {
  init(props, cx) {
    super.init?.(props, cx);
    this.activityFocus = [cx.focus_handle(), cx.focus_handle()];
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

  render(cx) {
    const id = props()?.pane;
    const pane = panes().find((item) => item.pane === id);
    if (pane?.mod === "pi-loop-monitor" && pane.terminal === null) return this.activityHeader(id);
    if (pane?.mod !== "pi-tasks" || pane.terminal !== null) return super.render(cx);
    const t = theme();
    return h_flex().id("tasks-header-" + id).size_full().px(10).items_center().gap(8)
      .bg(t.background).border_b(1).border_color(t.border).text_size(12)
      .on_click(() => run("pane.focus", { pane: id }))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child("Tasks"))
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
