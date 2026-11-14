/** Full, scrollable human preview; no model-supplied approval value is accepted. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";

export async function confirmCreation(ctx: ExtensionContext, preview: string, signal: AbortSignal): Promise<"Create" | undefined> {
  if (!ctx.hasUI || signal.aborted) return undefined;
  if (ctx.mode === "rpc") {
    // The supported RPC dialog carries the complete preview to the human UI.
    const choice = await ctx.ui.select(preview, ["Cancel", "Create"], { signal });
    return !signal.aborted && choice === "Create" ? "Create" : undefined;
  }
  if (ctx.mode !== "tui") return undefined;

  return ctx.ui.custom<"Create" | undefined>((tui, theme, keybindings, done) => {
    const body = new Text(preview, 0, 0);
    let offset = 0;
    let viewportHeight = 1;
    let contentHeight = 0;
    let createSelected = false;
    let finished = false;
    const finish = (choice?: "Create"): void => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      done(signal.aborted ? undefined : choice);
    };
    const onAbort = (): void => finish();
    signal.addEventListener("abort", onAbort, { once: true });
    return {
      render(width) {
        const heading = new Text(theme.fg("accent", "SchedulerCreate · human confirmation"), 0, 0).render(width);
        const footer = new Text([
          `${createSelected ? "  Cancel    [ Create ]" : "[ Cancel ]    Create"}`,
          "↑/↓ or PgUp/PgDn scroll · ←/→ or Tab choose · Enter accept · Esc cancel",
        ].join("\n"), 0, 0).render(width);
        const lines = body.render(width);
        contentHeight = lines.length;
        viewportHeight = Math.max(1, tui.terminal.rows - heading.length - footer.length - 3);
        offset = Math.max(0, Math.min(offset, contentHeight - viewportHeight));
        return [...heading, "", ...lines.slice(offset, offset + viewportHeight), "", ...footer];
      },
      handleInput(data) {
        if (keybindings.matches(data, "tui.select.cancel")) { finish(); return; }
        if (keybindings.matches(data, "tui.select.confirm")) { finish(createSelected ? "Create" : undefined); return; }
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.left) || matchesKey(data, Key.right)) createSelected = !createSelected;
        else if (keybindings.matches(data, "tui.select.up")) offset -= 1;
        else if (keybindings.matches(data, "tui.select.down")) offset += 1;
        else if (matchesKey(data, Key.pageUp)) offset -= viewportHeight;
        else if (matchesKey(data, Key.pageDown)) offset += viewportHeight;
        else if (matchesKey(data, Key.home)) offset = 0;
        else if (matchesKey(data, Key.end)) offset = contentHeight;
        else return;
        offset = Math.max(0, Math.min(offset, contentHeight - viewportHeight));
        tui.requestRender();
      },
      invalidate() { body.invalidate(); },
      dispose() { signal.removeEventListener("abort", onAbort); },
    };
  }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "100%" } });
}
