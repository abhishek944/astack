export type FocusPresentation = "focus" | "peek";
export interface FocusResult {
    focused: boolean;
    /** How the agent was shown: its own tab/pane, or the child screen overlay. */
    presentation?: FocusPresentation;
    reason?: string;
}
/**
 * App-only presentation. An unavailable desktop is reported, never fatal to the
 * Core terminal.
 *
 * `agent.focus` cannot show a pane-less sub-agent: the app acknowledges it and
 * changes nothing. The app's own listing separates a pane owner from a child
 * listed under its parent, so use `terminal.peek` for the child screen overlay.
 * The listing nests only one child level; a deeper live child has no listing
 * entry and is recognized by its nonempty Core parent. Another machine's
 * terminal is handled by the app's own focus path.
 */
export declare function focusTerminal(terminalId: string, cwd: string, signal?: AbortSignal): Promise<FocusResult>;
