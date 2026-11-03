export interface PanelSettings {
    enabled: boolean;
    mode: "floating" | "widget";
}
/** Defaults apply on startup/reload; slash commands only override this running instance. */
export declare function readPanelSettings(settings: unknown): PanelSettings;
