import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Select, Popup, Button, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";

/**
 * A controlled native Select: the trigger shows the chosen value, the popup is
 * searched by typing and moved with the arrow keys. Search text is never a
 * selected value, and a value that is no longer in the list still shows.
 */
export class Dropdown {
  constructor(id, label, cx, { searchable = false, placeholder = "Search…", searchLabel = "Search" } = {}) {
    this.id = id;
    this.label = label;
    this.open = false;
    this.highlight = 0;
    this.trigger = cx.focus_handle();
    this.content = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.search = searchable ? InputState.new({ placeholder }) : null;
    this.searchLabel = searchLabel;
    this.search?.on("change", (_event, inner) => { this.highlight = 0; this.scroll.scroll_to_item(0); inner.notify(); });
  }

  close(cx) {
    this.open = false;
    this.trigger.focus();
    cx.notify();
  }

  render(t, value, options, onSelect, extras = []) {
    const query = this.search?.value().trim().toLowerCase() ?? "";
    const scored = options.map((item, index) => ({ item, index, score: fuzzyScore(query, `${item.label} ${item.value} ${item.detail ?? ""}`.toLowerCase()) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.index - b.index);
    const rows = scored.map((entry) => entry.item);
    this.highlight = Math.max(0, Math.min(this.highlight, rows.length - 1));
    const selected = options.find((item) => item.value === value);
    const label = selected?.label ?? this.valueLabel ?? (value ? `${value} (unavailable)` : "Pi default");
    const choose = (item, cx) => {
      if (!item) return;
      onSelect(item.value, cx);
      this.close(cx);
    };
    const trigger = h_flex().id(`${this.id}-trigger`).h(32).w_full().min_w(0).px(9).gap(6).items_center()
      .bg(t.background).rounded(6).border(1).border_color(t.input)
      .track_focus(this.trigger).tab_index(0).tooltip(label).accessibility_label(`${this.label}: ${label}`)
      .focus((s) => s.border_color(t.accent))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => {
        this.open = !this.open;
        (this.open ? this.content : this.trigger).focus();
        cx.stop_propagation();
        cx.notify();
      })
      .on_key_down((event, cx) => {
        if (event.key === "space" || event.key === " ") {
          this.open = !this.open;
          if (this.open) this.content.focus();
          cx.stop_propagation(); cx.notify();
        }
      })
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(label))
      .child(div().text_size(11).text_color(t.muted).child("⌄"));
    const list = v_flex().id(`${this.id}-content`).w(this.menuWidth ?? (this.search ? 306 : 250)).min_w(0)
      .p(5).gap(4).rounded(6).border(1).border_color(t.input).bg(t.popover).text_color(t.foreground)
      .track_focus(this.content)
      .on_key_down((event, cx) => {
        if (event.key === "up" || event.key === "down") {
          this.highlight = Math.max(0, Math.min(rows.length - 1, this.highlight + (event.key === "down" ? 1 : -1)));
          this.scroll.scroll_to_item(this.highlight, "center");
          cx.stop_propagation(); cx.notify();
        } else if (event.key === "enter" || event.key === "return") {
          choose(rows[this.highlight], cx); cx.stop_propagation();
        } else if (event.key === "escape") {
          this.close(cx); cx.stop_propagation();
        }
      })
      .when(Boolean(this.search), (el) => el.child(
        Input.new(this.search).h(30).px(7).rounded(4).border(1).border_color(t.input).bg(t.background)
          .text_size(12).accessibility_label(this.searchLabel),
      ))
      .children(extras)
      .when(rows.length === 0 && Boolean(query), (el) => el.child(
        v_flex().p(6).gap(5).role("status").child("No matching models")
          .child(Button.new(`${this.id}-clear`).h(26).px(6).bg(t.chrome).rounded(4).accessibility_label("Clear search")
            .on_click((_event, cx) => { this.search.set_value(""); this.highlight = 0; cx.notify(); }).child("Clear search")),
      ))
      .when(rows.length > 0, (el) => el.child(
        v_flex().relative().h(Math.min(260, rows.length * (this.search ? 44 : 30)))
          .child(v_virtual_list(`${this.id}-options`, rows.length, this.search ? 44 : 30,
            (index) => rows[index].value || "default",
            (range) => rows.slice(range.start, range.end).map((item, offset) =>
              v_flex().id(`${this.id}-option-${item.value || "default"}`).min_w(0).px(7).py(6).gap(2).rounded(4)
                .role("list_box_option").accessibility_label(`${item.label}${item.detail ? ` · ${item.detail}` : ""}`)
                .selected(item.value === value).when(range.start + offset === this.highlight, (row) => row.aria_active_descendant())
                .bg(range.start + offset === this.highlight ? t.selected : t.popover).hover((s) => s.bg(t.hover))
                .child(div().text_size(12).truncate().child(item.label))
                .when(Boolean(item.detail), (row) => row.child(div().text_size(10).text_color(t.muted).truncate().child(item.detail))),
            )).track_scroll(this.scroll).role("list_box").accessibility_label(this.label)
            .on_item_click((key, cx) => choose(rows.find((item) => (item.value || "default") === key), cx)))
          .child(Scrollbar.vertical(`${this.id}-options`).absolute().inset_0()),
      ));
    return Select.new(this.id).accessibility_label(this.label).open(this.open)
      .track_focus(this.trigger).content_focus_handle(this.content)
      .on_open_change((open, cx) => { this.open = open; cx.notify(); })
      .on_confirm((_event, cx) => choose(rows[this.highlight], cx))
      .on_dismiss((_event, cx) => this.close(cx))
      .child(Popup.new(`${this.id}-popup`, trigger).anchor("bottom_left").when(this.open, (el) => el.content(list)));
  }
}

// Subsequence matching across real provider/id/name metadata, with exact and contiguous matches first.
function fuzzyScore(query, text) {
  if (!query) return 0;
  const contiguous = text.indexOf(query);
  if (contiguous >= 0) return contiguous;
  let cursor = 0;
  let score = text.length;
  for (const character of query) {
    const at = text.indexOf(character, cursor);
    if (at < 0) return null;
    score += at - cursor;
    cursor = at + 1;
  }
  return score + text.length;
}
