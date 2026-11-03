import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/** Show beside this terminal, or hide only its same-session Tasks mod panes. */
export declare function setHerdrTasksPaneVisible(ctx: ExtensionContext, visible: boolean, snapshot: string, openCommand?: string[]): Promise<void>;
