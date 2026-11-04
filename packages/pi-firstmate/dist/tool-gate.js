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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
const INSPECTION_TOOLS = new Set(["read", "grep", "find", "ls"]);
/** Installed packages whose tools stay available to a coordinator. */
export const APPROVED_PACKAGES = new Set([
    "@abhishek944/pi-tasks",
    "@abhishek944/pi-loop-monitor",
    "@abhishek944/pi-decisions",
    "@abhishek944/pi-herdr",
]);
export const COORDINATOR_TOOLS_DESCRIPTION = "read, grep, find, ls and installed pi-tasks, pi-loop-monitor, pi-decisions and pi-herdr tools";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sourceBaseDir(sourceInfo) {
    if (sourceInfo.baseDir !== undefined)
        return sourceInfo.baseDir;
    if (sourceInfo.path.startsWith("builtin:") || sourceInfo.path.startsWith("<"))
        return undefined;
    return dirname(sourceInfo.path);
}
export function createToolGate(pi) {
    const packageApproval = new Map();
    // Package identity comes from the registration's installed package root, not
    // from a tool name list or self-declared annotations. The extension entry can
    // live in `dist/` (explicit extension paths) or the package root (discovered
    // packages), so walk to the nearest manifest. A missing or unreadable manifest
    // stays unapproved so new or unexpected tools fail closed.
    function approvedSource(sourceInfo) {
        const baseDir = sourceBaseDir(sourceInfo);
        if (baseDir === undefined)
            return false;
        const cached = packageApproval.get(baseDir);
        if (cached !== undefined)
            return cached;
        let approved = false;
        let directory = baseDir;
        while (true) {
            try {
                const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
                approved =
                    isRecord(manifest) && typeof manifest.name === "string" && APPROVED_PACKAGES.has(manifest.name);
                break;
            }
            catch {
                const parent = dirname(directory);
                if (parent === directory)
                    break;
                directory = parent;
            }
        }
        packageApproval.set(baseDir, approved);
        return approved;
    }
    // Rebuild from the live registry so tools registered after session start are
    // classified from their actual installation instead of a stale snapshot.
    function allowedNames() {
        const allowed = new Set(INSPECTION_TOOLS);
        for (const tool of pi.getAllTools()) {
            if (approvedSource(tool.sourceInfo))
                allowed.add(tool.name);
        }
        return allowed;
    }
    return {
        permits(toolName) {
            if (INSPECTION_TOOLS.has(toolName))
                return true;
            try {
                return allowedNames().has(toolName);
            }
            catch {
                return false;
            }
        },
        hide() {
            const allowed = allowedNames();
            const active = pi.getActiveTools();
            const kept = active.filter((name) => allowed.has(name));
            const hidden = active.filter((name) => !allowed.has(name));
            if (hidden.length > 0)
                pi.setActiveTools(kept);
            return hidden;
        },
        reason(toolName) {
            return `First Mate coordinator mode blocks ${JSON.stringify(toolName)}. Only ${COORDINATOR_TOOLS_DESCRIPTION} are available in this coordinator session, including for nested tool calls. This is an intentional coordinator restriction, not a missing permission: do not ask to enable the tool. Check that an installed delegation backend is ready and delegate the work through its orchestration tools, or run /firstmate off before doing it locally.`;
        },
    };
}
