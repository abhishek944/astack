export interface HerdrPanelSettings {
  enabled: boolean;
}

/**
 * Startup default for the native Herdr Loops/Monitors pane. Pi owns settings
 * loading and merging, so this validates only the section it owns. Missing
 * values stay off; a malformed value is reported and treated as off. Commands
 * still override the running instance and never rewrite settings.
 */
export function readHerdrPanelSettings(settings: unknown): HerdrPanelSettings {
  const root = object(settings);
  const config = object(root?.["pi-loop-monitor"]);
  const raw = config?.herdrPanel;
  if (raw === undefined) return { enabled: false };
  const panel = object(raw);
  if (!panel || (panel.enabled !== undefined && typeof panel.enabled !== "boolean")) {
    throw new Error("pi-loop-monitor.herdrPanel must contain an optional boolean enabled field.");
  }
  return { enabled: panel.enabled === true };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
