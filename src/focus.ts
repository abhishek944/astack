import { app, TERMINAL_ID } from "./herdr.js";

export async function focusTerminal(terminalId: string, cwd: string, signal?: AbortSignal): Promise<void> {
  if (!TERMINAL_ID.test(terminalId)) throw new Error("Use the terminalId returned by hc.");
  await app(["do", "agent.focus", JSON.stringify({ terminal: terminalId })], cwd, signal);
}
