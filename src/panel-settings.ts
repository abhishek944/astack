export interface PanelSettings {
  enabled: boolean;
  mode: "floating" | "widget";
}

/** Defaults apply on startup/reload; slash commands only override this running instance. */
export function readPanelSettings(settings: unknown): PanelSettings {
  const root = object(settings);
  const config = object(root?.["pi-tasks"]);
  const raw = config?.panel;
  if (raw === undefined) return { enabled: false, mode: "floating" };
  const panel = object(raw);
  if (!panel || (panel.enabled !== undefined && typeof panel.enabled !== "boolean")
    || (panel.mode !== undefined && panel.mode !== "floating" && panel.mode !== "widget")) {
    throw new Error("pi-tasks.panel must contain an optional boolean enabled and mode floating|widget.");
  }
  return { enabled: panel.enabled === true, mode: panel.mode === "widget" ? "widget" : "floating" };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
