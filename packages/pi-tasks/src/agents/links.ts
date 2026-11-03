import { taskOwner } from "../ownership.js";
import { app, TERMINAL_ID } from "./herdr.js";

export interface DelegateLink { terminalId: string }

export function delegateLink(taskInfo: string): DelegateLink | undefined {
  if (taskOwner(taskInfo) !== "delegate") return undefined;
  const terminals = [...taskInfo.matchAll(/^[ \t]*hc-terminal:[ \t]*([^\r\n]*)$/gim)].map((match) => match[1]!.trim());
  if (terminals.length === 0 || terminals.some((terminal) => !TERMINAL_ID.test(terminal)) || new Set(terminals).size !== 1) return undefined;
  return { terminalId: terminals[0]! };
}

export async function focusTerminal(terminalId: string, cwd: string, signal?: AbortSignal): Promise<void> {
  if (!TERMINAL_ID.test(terminalId)) throw new Error("Use the terminalId returned by hc.");
  await app(["do", "agent.focus", JSON.stringify({ terminal: terminalId })], cwd, signal);
}

export function preservePaneLink(current: string, next: string): string {
  if (taskOwner(current) !== "delegate" || taskOwner(next) !== "delegate" || /^[ \t]*(?:hc-(?:terminal|monitor)|herdr-(?:pane|monitor)):/im.test(next)) return next;
  // Preserve historical links as text, but never interpret a TUI pane as a Core terminal.
  const metadata = current.split(/\r?\n/).filter((line) => /^[ \t]*(?:hc-(?:terminal|monitor)|herdr-(?:pane|monitor)):/i.test(line));
  return metadata.length ? `${next.trim()}\n${metadata.join("\n")}` : next;
}

export function withTerminalLink(taskInfo: string, terminalId?: string, monitorId?: string): string {
  const text = taskInfo.split(/\r?\n/).filter((line) => !/^[ \t]*(?:hc-(?:terminal|monitor)|herdr-(?:pane|monitor)):/i.test(line)).join("\n").trim();
  return terminalId ? `${text}\nhc-terminal: ${terminalId}\nhc-monitor: ${monitorId}` : text;
}
