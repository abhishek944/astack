import { app, TERMINAL_ID } from "./herdr.js";
/** App-only focus. An unavailable desktop is reported, never fatal to the Core terminal. */
export async function focusTerminal(terminalId, cwd, signal) {
    if (!TERMINAL_ID.test(terminalId))
        throw new Error("Use the terminalId returned by hc.");
    try {
        await app(["do", "agent.focus", JSON.stringify({ terminal: terminalId })], cwd, signal);
        return { focused: true };
    }
    catch (error) {
        return { focused: false, reason: `Herdr app focus failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
