export interface FocusResult {
    focused: boolean;
    reason?: string;
}
/** App-only focus. An unavailable desktop is reported, never fatal to the Core terminal. */
export declare function focusTerminal(terminalId: string, cwd: string, signal?: AbortSignal): Promise<FocusResult>;
