/**
 * Optional native Herdr banner for First Mate.
 *
 * A personal Herdr layout gets one extra block above the block that contains
 * the shown tab. That block loads `mods/firstmate-banner`, which reads the
 * small per-session state files written here and shows the strip only for the
 * active tab's live First Mate session.
 *
 * Everything in this module is best-effort. First Mate's mode, guidance and
 * status keep working when Herdr is absent, the shown layout is shipped, or a
 * file cannot be written.
 */
export declare const BANNER_MOD = "firstmate-banner";
export declare const BANNER_NODE_ID = "firstmate-banner";
export interface BannerSetup {
    /** installed: this call wrote something. present: everything already matched. */
    state: "installed" | "present" | "unavailable";
    detail: string;
}
export interface BannerState {
    sessionId: string;
    terminal: string;
    effective: boolean;
}
/**
 * The Herdr app home, matching the app's own lookup: `HERDR_APP_HOME`, else
 * `XDG_CONFIG_HOME/herdr-app`, else `~/.config/herdr-app`.
 */
export declare function herdrAppHome(env?: NodeJS.ProcessEnv): string;
/**
 * Make the installed mod and the shown personal layout ready for the banner.
 * Callers treat `unavailable` as a diagnostic, never as a First Mate failure.
 */
export declare function ensureHerdrBanner(appHome: string, assets: URL): BannerSetup;
/**
 * Publish this session's effective mode for the banner mod. The file is
 * replaced atomically; a file left by an earlier Pi session in the same
 * terminal is removed so it cannot override this one.
 */
export declare function writeBannerState(appHome: string, state: BannerState): void;
/** Best-effort shutdown cleanup; the banner disappears as soon as this file is gone. */
export declare function clearBannerState(appHome: string, sessionId: string, terminal?: string): void;
