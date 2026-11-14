import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
export interface HerdrTasksPaneOptions {
    /** Close this terminal's Tasks pane from an earlier session before opening the current one. */
    replaceStale?: boolean;
}
/** Show beside this terminal, or hide only its same-session Tasks mod panes. */
export declare function setHerdrTasksPaneVisible(ctx: ExtensionContext, visible: boolean, snapshot: string, openCommand?: string[], options?: HerdrTasksPaneOptions): Promise<void>;
