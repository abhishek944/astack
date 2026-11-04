// First Mate's native banner strip.
//
// The pi-firstmate extension installs this mod and inserts a `firstmate-banner`
// block above the active-tab block of the shown personal layout. That block is
// always present (never `hidden`, so this copy stays alive to follow tab
// changes) and is 0 px while First Mate is off. This mod reads the extension's
// per-session state, shows the strip only when the ACTIVE TAB contains a live
// First Mate session, and resizes its own layout node to 30 px / 0 px.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import * as fs from "fs/promises";
import { agents, appHome, layout, panes, run, spaces, terminals, watchFolder } from "herdr";

const MOD = "firstmate-banner";
const NODE = "firstmate-banner";
const HEIGHT = 30;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TERMINAL = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?t[0-9a-z]+$/;

// Warm amber that stays readable in both light and dark themes. Ink on amber
// is about 7:1.
const AMBER = "#d99a16";
const AMBER_BORDER = "#b87e0a";
const AMBER_CHIP_TEXT = "#ffe6a3";
const INK = "#241a02";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function find(node, id) {
  if (record(node) && node.id === id) return node;
  for (const child of record(node) && Array.isArray(node.children) ? node.children : []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The extension writes only these fields. Anything else is ignored rather than
// trusted, so a damaged or foreign file cannot make the banner appear.
function isState(value) {
  return (
    record(value) &&
    value.version === 1 &&
    typeof value.sessionId === "string" &&
    SESSION.test(value.sessionId) &&
    typeof value.terminal === "string" &&
    TERMINAL.test(value.terminal) &&
    typeof value.effective === "boolean" &&
    Number.isSafeInteger(value.updatedAt) &&
    value.updatedAt > 0
  );
}

export default class FirstMateBanner extends View {
  init(_props, cx) {
    this.directory = `${appHome()}/data/${MOD}`;
    this.sessions = new Map();
    this.closed = false;
    cx.spawn(async (cx) => {
      try {
        await fs.mkdir(this.directory, { recursive: true });
      } catch {
        // The extension creates this folder too; a read-only home just means no
        // sessions are known and the strip stays collapsed.
      }
      for (;;) {
        await this.reload();
        if (this.closed) return;
        cx.notify();
        try {
          await watchFolder(this.directory);
        } catch {
          return;
        }
        if (this.closed) return;
      }
    });
  }

  async close() {
    this.closed = true;
  }

  async reload() {
    const sessions = new Map();
    let names = [];
    try {
      names = await fs.readdir(this.directory);
    } catch {
      this.sessions = sessions;
      return;
    }
    for (const name of names) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      try {
        const value = JSON.parse(await fs.readFile(`${this.directory}/${name}`, "utf8"));
        if (!isState(value)) continue;
        // One terminal runs one Pi session; the newest state wins after a
        // replacement session starts in the same terminal.
        const previous = sessions.get(value.terminal);
        if (!previous || previous.updatedAt <= value.updatedAt) sessions.set(value.terminal, value);
      } catch {
        // Ignore a half-written or foreign file; the next change reloads.
      }
    }
    this.sessions = sessions;
  }

  // Visibility is per shown tab, not per window and not per focused pane.
  // Live checks keep a state file left by a crashed Pi process from winning.
  match() {
    const space = spaces().find((item) => item.active);
    const tab = space?.tabs.find((item) => item.active);
    if (!tab) return null;
    const live = new Set(terminals().filter((item) => record(item) && item.state === "live").map((item) => item.address));
    const running = new Set(agents().map((item) => item.address));
    const own = panes()
      .filter((pane) => pane.tab === tab.id && typeof pane.terminal === "string")
      .filter((pane) => {
        const state = this.sessions.get(pane.terminal);
        return state?.effective === true && live.has(pane.terminal) && running.has(pane.terminal);
      })
      .map((pane) => pane.terminal);
    if (own.length === 0) return null;
    const focused = panes().find((pane) => pane.tab === tab.id && pane.focused)?.terminal;
    return typeof focused === "string" && own.includes(focused) ? focused : own[0];
  }

  render() {
    const terminal = this.match();
    const node = find(layout(), NODE);
    const size = node && record(node.size) && typeof node.size.px === "number" ? node.size.px : HEIGHT;
    const want = terminal === null ? 0 : HEIGHT;
    // layout() reports the applied click state, so this settles after one call
    // per change instead of resizing on every render.
    if (node && size !== want) run("layout.resize", { id: NODE, px: want });
    if (terminal === null) return div();
    return h_flex()
      .id(NODE)
      .size_full()
      .min_w(0)
      .px(12)
      .gap(10)
      .items_center()
      .bg(AMBER)
      .border_b(1)
      .border_color(AMBER_BORDER)
      .accessibility_label("First Mate coordinator mode is on for this session; read the installed First Mate skill")
      .child(
        h_flex()
          .h(18)
          .px(7)
          .flex_none()
          .rounded(4)
          .items_center()
          .bg(INK)
          .child(div().text_size(10.5).font_semibold().text_color(AMBER_CHIP_TEXT).child("FIRST MATE")),
      )
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(INK).child("Coordinator mode · read the First Mate skill"));
  }
}
