/**
 * Coordinator tool gating for First Mate.
 *
 * While coordinator mode is effective, only the four inspection tools and tools
 * registered by the approved orchestration packages stay available. Other
 * active tools are removed from the model-facing set, and every call, including
 * a nested call issued through `ctx.executeTool()`, is checked again at Pi's
 * `tool_call` boundary.
 *
 * This is tool-call enforcement, not an OS sandbox. An allowed tool can still
 * perform whatever its own implementation exposes, so permission, trust and
 * authorization boundaries remain in force.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/** Installed packages whose tools stay available to a coordinator. */
export declare const APPROVED_PACKAGES: Set<string>;
export declare const COORDINATOR_TOOLS_DESCRIPTION = "read, grep, find, ls and installed pi-tasks, pi-loop-monitor, pi-decisions and pi-herdr tools";
type ToolHost = Pick<ExtensionAPI, "getActiveTools" | "getAllTools" | "setActiveTools">;
export interface ToolGate {
    /** Whether coordinator mode may call this tool. */
    permits(toolName: string): boolean;
    /** Hide every active tool outside the allowlist and return the hidden names. */
    hide(): string[];
    /** Actionable explanation for a rejected direct or nested call. */
    reason(toolName: string): string;
}
export declare function createToolGate(pi: ToolHost): ToolGate;
export {};
