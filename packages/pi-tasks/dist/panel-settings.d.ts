export interface PanelSettings {
    enabled: boolean;
    mode: "floating" | "widget";
}
export interface HerdrPanelSettings {
    enabled: boolean;
}
/** Startup default for the native Herdr Tasks pane; commands still override this running instance. */
export declare function readHerdrPanelSettings(settings: unknown): HerdrPanelSettings;
/** Defaults apply on startup/reload; slash commands only override this running instance. */
export declare function readPanelSettings(settings: unknown): PanelSettings;
