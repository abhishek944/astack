import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPiAskGuard, type PiAskGuard } from "./guard.js";

// Package identity is @abhishek944/pi-research. The `pi-ask:` guard event
// namespace, the `PiAskGuard` API names and the owner id below are retained
// compatibility identifiers: other extensions acquire this guard through the
// `pi-ask:guard:*` protocol (version 1).
const ASK_OWNER_ID = "pi-ask:/ask";
const ASK_TOOLS_COMMAND = /^\/ask\s+tools$/;
const ASK_MODE_COMMAND = /^\/ask\s+(on|off|status)$/;
const MAX_LISTED_TOOL_NAMES = 24;
const STATUS_KEY = "ask";
const ASK_INDICATOR = "Ask · read-only";
const ASK_TOOL_NAMES = [
  "read",
  "grep",
  "find",
  "ls",
  "web_enable",
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content",
  "MonitorList",
  "LoopList",
  "WorkList",
  "TodoList",
];

function formatToolNames(names: string[]): string {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return "    (none)";
  const shown = sorted.slice(0, MAX_LISTED_TOOL_NAMES);
  const lines = [`    ${shown.join(", ")}`];
  if (shown.length < sorted.length) {
    lines.push(`    …and ${sorted.length - shown.length} more (${sorted.length} total)`);
  }
  return lines.join("\n");
}

function askIndicator(ctx: ExtensionContext): string {
  return ctx.ui.theme.fg("warning", ASK_INDICATOR);
}

// Local, metadata-only report for `/ask tools`. It reads the live active tool set
// and the registered-tool registry, and never acquires the guard, changes active
// tools, starts a model turn, or persists anything.
function buildAskToolsReport(pi: ExtensionAPI, guard: PiAskGuard): string {
  const active = pi.getActiveTools();
  const registered = new Set(pi.getAllTools().map((tool) => tool.name));
  const policy = new Set(ASK_TOOL_NAMES);
  const askOwnsGuard = guard.isActive(ASK_OWNER_ID);
  const askModeOn = guard.isPersistent(ASK_OWNER_ID);
  const restrictedRunActive = guard.isActive();

  const effective = active.filter((name) => policy.has(name));
  const activeOutsidePolicy = active.filter((name) => !policy.has(name));
  const inactiveAllowed = ASK_TOOL_NAMES.filter((name) => registered.has(name) && !active.includes(name));
  const absentAllowed = ASK_TOOL_NAMES.filter((name) => !registered.has(name));
  const lines: string[] = [];

  if (askOwnsGuard) {
    lines.push(askModeOn ? "Ask tools (persistent read-only mode)" : "Ask tools (active)");
    if (askModeOn) {
      lines.push("Ask is on. Every ordinary prompt keeps only the read-only policy until /ask off.");
    } else {
      lines.push("The built-in Ask policy is active for the current answer.");
    }
    lines.push(`Effective tools for this answer (${effective.length} of ${ASK_TOOL_NAMES.length} allowlisted):`);
    lines.push(formatToolNames(effective));
    if (activeOutsidePolicy.length > 0) {
      lines.push(`Active but still blocked by the Ask guard (${activeOutsidePolicy.length}):`);
      lines.push(formatToolNames(activeOutsidePolicy));
    }
  } else if (restrictedRunActive) {
    lines.push("Ask tools (restricted run active)");
    lines.push("Another extension owns the current restricted run, so the built-in Ask policy is not in effect. This report cannot verify that run's policy.");
    lines.push(`Active tools now (${active.length}):`);
    lines.push(formatToolNames(active));
    lines.push("Ask cannot start until that restricted run finishes. Run /ask tools again afterward for an Ask preview.");
    lines.push("Registered or active names are not a health check; a tool or provider may still fail at runtime.");
    return lines.join("\n");
  } else {
    lines.push("Ask tools (preview)");
    lines.push("Ask is not active. This preview is based on the tools active right now; it changes nothing.");
    lines.push(`Available if /ask runs now (${effective.length} of ${ASK_TOOL_NAMES.length} allowlisted):`);
    lines.push(formatToolNames(effective));
    if (activeOutsidePolicy.length > 0) {
      lines.push(`Active now but removed for an Ask run (${activeOutsidePolicy.length}):`);
      lines.push(formatToolNames(activeOutsidePolicy));
    }
  }

  if (inactiveAllowed.length > 0) {
    lines.push(`Allowlisted but inactive right now (${inactiveAllowed.length}):`);
    lines.push(formatToolNames(inactiveAllowed));
    if (registered.has("web_enable")) {
      lines.push("web_enable can add the configured web lookup tools during an answer; this report re-reads the active tool set each time.");
    }
  }
  if (absentAllowed.length > 0) {
    lines.push(`Allowlisted but not registered in Pi (${absentAllowed.length}):`);
    lines.push(formatToolNames(absentAllowed));
    lines.push("Pi has no registered tool with these names right now. The reason is unknown; this report cannot tell whether a tool was never installed, is disabled, or was not provided.");
  }

  lines.push("The Ask policy contains read-only tools only.");
  lines.push("Always blocked for an Ask run: shell, file-changing and generation tools such as bash, edit, write, image_generate and sprite_generate are removed and re-checked before every call; work, todo, loop and monitor mutations are not in the Ask policy (only their list and status tools are).");
  lines.push("Registered or active names are not a health check; a tool or provider may still fail at runtime.");
  return lines.join("\n");
}

function buildAskStatusReport(pi: ExtensionAPI, guard: PiAskGuard): string {
  const active = pi.getActiveTools();
  const policy = new Set(ASK_TOOL_NAMES);
  const effective = active.filter((name) => policy.has(name));
  const lines: string[] = [];

  if (guard.isPersistent(ASK_OWNER_ID)) {
    lines.push("Ask: on (persistent read-only)");
    lines.push(`Ordinary prompts keep only the ${effective.length} active read-only tool(s) until /ask off.`);
    lines.push(`Active tools now (${active.length}):`);
    lines.push(formatToolNames(active));
    lines.push("Run /ask tools for the full capability report, or /ask off to restore the previous tools.");
    return lines.join("\n");
  }
  if (guard.isActive(ASK_OWNER_ID)) {
    lines.push("Ask: answering one question with read-only tools");
    lines.push("The previous tool set returns automatically when that answer settles.");
    return lines.join("\n");
  }
  lines.push(guard.isActive() ? "Ask: off (another extension owns the current read-only run)" : "Ask: off");
  if (effective.length === 0) {
    lines.push("Ask cannot turn on until at least one allowlisted read-only tool is active.");
  } else {
    lines.push(`/ask on would keep ${effective.length} of ${ASK_TOOL_NAMES.length} allowlisted tools that are active right now.`);
  }
  lines.push("Run /ask on to keep ordinary prompts read-only until /ask off.");
  return lines.join("\n");
}

export default function askExtension(pi: ExtensionAPI): void {
  let latestCtx: ExtensionContext | undefined;
  const guard = createPiAskGuard(pi, {
    onReleased: (ctx) => {
      const current = ctx ?? latestCtx;
      if (!current) return;
      current.ui.setStatus(STATUS_KEY, guard.isActive(ASK_OWNER_ID) ? askIndicator(current) : undefined);
    },
  });

  function notifyAskUsage(ctx: ExtensionContext): void {
    ctx.ui.notify(
      "Usage: /ask <question> | /ask on | /ask off | /ask status | /ask tools",
      "info",
    );
  }

  pi.on("input", (event, ctx) => {
    latestCtx = ctx;

    if (ASK_TOOLS_COMMAND.test(event.text)) {
      ctx.ui.notify(buildAskToolsReport(pi, guard), "info");
      return { action: "handled" };
    }

    // A failed startup can leave a one-shot acquisition without a run to settle.
    // Persistent Ask mode is owned explicitly and is never released here.
    if (ctx.isIdle() && guard.isActive(ASK_OWNER_ID) && !guard.isPersistent(ASK_OWNER_ID)) {
      const token = guard.getAcquisitionToken();
      if (token) guard.release(ASK_OWNER_ID, token, ctx);
    }

    const modeMatch = event.text.match(ASK_MODE_COMMAND);
    if (modeMatch) {
      const command = modeMatch[1];
      if (command === "status") {
        ctx.ui.notify(buildAskStatusReport(pi, guard), "info");
        return { action: "handled" };
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current answer to finish before changing Ask mode.", "warning");
        return { action: "handled" };
      }

      if (command === "on") {
        if (guard.isActive(ASK_OWNER_ID)) {
          ctx.ui.notify(
            guard.isPersistent(ASK_OWNER_ID)
              ? "Ask is already on. Ordinary prompts stay read-only until /ask off."
              : "Ask is already active for the current answer.",
            "info",
          );
          return { action: "handled" };
        }
        if (guard.isActive()) {
          ctx.ui.notify(
            "Another extension owns the current read-only run. Try /ask on again when it finishes.",
            "warning",
          );
          return { action: "handled" };
        }
        if (pi.getActiveTools().filter((name) => ASK_TOOL_NAMES.includes(name)).length === 0) {
          ctx.ui.notify(
            "Ask cannot turn on: none of the read-only Ask tools are active right now. No tools were changed.",
            "warning",
          );
          return { action: "handled" };
        }
        const result = guard.acquire({
          ownerId: ASK_OWNER_ID,
          allowedTools: ASK_TOOL_NAMES,
          persistent: true,
          sessionId: ctx.sessionManager.getSessionId(),
        });
        if (result.status !== "active" || !result.acquisitionToken) {
          ctx.ui.notify("Ask could not turn on. No tools were changed.", "warning");
          return { action: "handled" };
        }
        ctx.ui.setStatus(STATUS_KEY, askIndicator(ctx));
        ctx.ui.notify(
          `Ask is on. Ordinary prompts keep only the ${result.activeTools?.length ?? 0} active read-only tool(s) until /ask off.`,
          "info",
        );
        return { action: "handled" };
      }

      if (!guard.isActive(ASK_OWNER_ID)) {
        ctx.ui.notify("Ask is off.", "info");
        return { action: "handled" };
      }
      if (!guard.isPersistent(ASK_OWNER_ID)) {
        ctx.ui.notify(
          "Ask is answering one question. Wait for it to finish before turning it off.",
          "warning",
        );
        return { action: "handled" };
      }
      const token = guard.getAcquisitionToken();
      if (!token || !guard.release(ASK_OWNER_ID, token, ctx)) {
        ctx.ui.notify("Ask could not turn off.", "warning");
        return { action: "handled" };
      }
      ctx.ui.notify("Ask is off. The previous tool set is restored.", "info");
      return { action: "handled" };
    }

    const match = event.text.match(/^\/ask(?:\s+([\s\S]*))?$/);
    if (!match) return;

    const question = match[1]?.trim();
    if (!question) {
      notifyAskUsage(ctx);
      return { action: "handled" };
    }

    if (!ctx.isIdle()) {
      ctx.ui.notify("Wait for the current answer to finish before using /ask.", "warning");
      return { action: "handled" };
    }

    // A persistent Ask mode already enforces the same policy; the question only
    // needs to be transformed into an ordinary prompt.
    if (!guard.isActive(ASK_OWNER_ID)) {
      const result = guard.acquire({
        ownerId: ASK_OWNER_ID,
        allowedTools: ASK_TOOL_NAMES,
      });
      if (result.status !== "active" || !result.acquisitionToken) {
        return { action: "handled" };
      }
      ctx.ui.setStatus(STATUS_KEY, askIndicator(ctx));
    }

    return event.images
      ? { action: "transform", text: question, images: event.images }
      : { action: "transform", text: question };
  });

  pi.on("before_agent_start", () => {
    const context = guard.getContext();
    if (!context) return;
    return {
      message: {
        customType: "pi-ask-context",
        content: context,
        display: false,
        details: { acquisitionToken: guard.getAcquisitionToken() },
      },
    };
  });

  pi.on("context", (event) => {
    const acquisitionToken = guard.getAcquisitionToken();
    return {
      messages: event.messages.filter((message) => {
        if (!("customType" in message) || message.customType !== "pi-ask-context") return true;
        if (!acquisitionToken) return false;
        return (message as { details?: { acquisitionToken?: string } }).details?.acquisitionToken === acquisitionToken;
      }),
    };
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}

export {
  createPiAskGuard,
  PI_ASK_GUARD_ACQUIRE_EVENT,
  PI_ASK_GUARD_PROBE_EVENT,
  PI_ASK_GUARD_RELEASE_EVENT,
  PI_ASK_GUARD_RELEASED_EVENT,
  PI_ASK_GUARD_RUN_START_EVENT,
} from "./guard.js";
export type {
  GuardConstraintValue,
  PiAskGuard,
  PiAskGuardAcquireRequest,
  PiAskGuardAcquireResult,
  PiAskGuardProbeRequest,
  PiAskGuardReleaseRequest,
  PiAskGuardToolRule,
} from "./guard.js";
