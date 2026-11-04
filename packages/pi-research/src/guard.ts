import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PI_ASK_GUARD_ACQUIRE_EVENT = "pi-ask:guard:acquire";
export const PI_ASK_GUARD_RELEASE_EVENT = "pi-ask:guard:release";
export const PI_ASK_GUARD_RELEASED_EVENT = "pi-ask:guard:released";
export const PI_ASK_GUARD_RUN_START_EVENT = "pi-ask:guard:run-start";
export const PI_ASK_GUARD_PROBE_EVENT = "pi-ask:guard:probe";

export type GuardConstraintValue = string | number | boolean | null;

const BUILTIN_TOOL_NAMES = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);

export interface PiAskGuardToolRule {
  name: string;
  equals?: Record<string, GuardConstraintValue>;
  sourceInfo?: { source: string; path: string };
}

export interface PiAskGuardAcquireResult {
  status: "active" | "rejected";
  ownerId?: string;
  acquisitionToken?: string;
  activeTools?: string[];
  reason?: "busy" | "invalid-request" | "activation-failed";
}

export interface PiAskGuardAcquireRequest {
  ownerId: string;
  allowedTools: Array<string | PiAskGuardToolRule>;
  context?: string;
  /** Set when acquisition immediately precedes a programmatic custom-message run. */
  startsRun?: boolean;
  /** Keep the restriction after the current run settles until the owner releases it. */
  persistent?: boolean;
  /** Session that owns the acquisition. A release from another session never applies its baseline. */
  sessionId?: string;
  response?: PiAskGuardAcquireResult;
}

export interface PiAskGuardReleaseRequest {
  ownerId: string;
  acquisitionToken: string;
  released?: boolean;
}

export interface PiAskGuardProbeRequest {
  available?: boolean;
  protocolVersion?: number;
  active?: boolean;
}

export interface PiAskGuard {
  acquire(request: PiAskGuardAcquireRequest): PiAskGuardAcquireResult;
  release(ownerId: string, acquisitionToken: string, ctx?: ExtensionContext): boolean;
  isActive(ownerId?: string): boolean;
  /** Whether the active acquisition (or the named owner's acquisition) outlives a settled run. */
  isPersistent(ownerId?: string): boolean;
  getContext(): string | undefined;
  getAcquisitionToken(): string | undefined;
}

interface ActiveGuard {
  ownerId: string;
  generation: number;
  acquisitionToken: string;
  rules: PiAskGuardToolRule[];
  toolsBeforeGuard: string[];
  context?: string;
  persistent: boolean;
  sessionId?: string;
}

function normalizeRules(rules: PiAskGuardAcquireRequest["allowedTools"]): PiAskGuardToolRule[] | undefined {
  if (!Array.isArray(rules)) return undefined;
  const normalized: PiAskGuardToolRule[] = [];
  for (const candidate of rules) {
    const rule = typeof candidate === "string" ? { name: candidate } : candidate;
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || typeof rule.name !== "string" || !rule.name.trim()) return undefined;
    let equals: Record<string, GuardConstraintValue> | undefined;
    if ("equals" in rule) {
      if (!rule.equals || typeof rule.equals !== "object" || Array.isArray(rule.equals)) return undefined;
      const entries = Object.entries(rule.equals);
      if (entries.length === 0 || entries.some(([, value]) =>
        value !== null && (
          !["string", "number", "boolean"].includes(typeof value)
          || (typeof value === "number" && !Number.isFinite(value))
        )
      )) return undefined;
      equals = Object.fromEntries(entries) as Record<string, GuardConstraintValue>;
    }
    let sourceInfo: PiAskGuardToolRule["sourceInfo"];
    if ("sourceInfo" in rule) {
      const source = rule.sourceInfo;
      if (!source || typeof source !== "object" || Array.isArray(source)
        || typeof source.source !== "string" || !source.source
        || typeof source.path !== "string" || !source.path) return undefined;
      sourceInfo = { source: source.source, path: source.path };
    }
    normalized.push({ name: rule.name, ...(equals ? { equals } : {}), ...(sourceInfo ? { sourceInfo } : {}) });
  }
  return normalized;
}

function hasTrustedProvenance(pi: ExtensionAPI, rules: PiAskGuardToolRule[]): boolean {
  const tools = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
  return rules.every((rule) => {
    const sourceInfo = tools.get(rule.name)?.sourceInfo;
    if (!sourceInfo) return true;
    if (BUILTIN_TOOL_NAMES.has(rule.name)) {
      return sourceInfo.source === "builtin"
        && (sourceInfo.path === `builtin:${rule.name}` || sourceInfo.path === `<builtin:${rule.name}>`);
    }
    if (!rule.sourceInfo) return true;
    return sourceInfo.source === rule.sourceInfo.source && sourceInfo.path === rule.sourceInfo.path;
  });
}

function ruleMatchesInput(rule: PiAskGuardToolRule, input: unknown): boolean {
  if (!rule.equals) return true;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  return Object.entries(rule.equals).every(([field, expected]) => Object.is(record[field], expected));
}

export function createPiAskGuard(
  pi: ExtensionAPI,
  options: { onReleased?: (ctx?: ExtensionContext) => void } = {},
): PiAskGuard {
  let active: ActiveGuard | undefined;
  let nextGeneration = 1;
  const runs: Array<{ guardGeneration: number | undefined; started: boolean }> = [];
  let shuttingDown = false;

  function recordRun(guardGeneration: number | undefined) {
    runs.push({ guardGeneration, started: false });
  }

  function release(ownerId: string, acquisitionToken: string, ctx?: ExtensionContext, notifyReleased = true): boolean {
    if (!active || active.ownerId !== ownerId || active.acquisitionToken !== acquisitionToken) return false;
    const acquisition = active;
    const pendingIndex = runs.findLastIndex((run) => !run.started && run.guardGeneration === acquisition.generation);
    if (pendingIndex >= 0) runs.splice(pendingIndex, 1);
    // Restore exactly the tool list captured at acquisition. A recorded session
    // id may only restore that session's list; another session drops the stale
    // capture instead of applying it.
    if (mayApplyBaseline(acquisition, ctx)) pi.setActiveTools(acquisition.toolsBeforeGuard);
    active = undefined;
    options.onReleased?.(ctx);
    if (notifyReleased) pi.events.emit(PI_ASK_GUARD_RELEASED_EVENT, { ownerId });
    return true;
  }

  /**
   * A recorded session id may only restore that session's baseline. When the
   * releasing context belongs to another session, the stale snapshot is dropped
   * instead of being applied to a tool set it was never captured from.
   */
  function mayApplyBaseline(acquisition: ActiveGuard, ctx?: ExtensionContext): boolean {
    if (!acquisition.sessionId || !ctx) return true;
    try {
      return ctx.sessionManager.getSessionId() === acquisition.sessionId;
    } catch {
      return false;
    }
  }

  function reassertRestriction(): void {
    if (!active) return;
    const allowed = new Set(active.rules.map((rule) => rule.name));
    const current = pi.getActiveTools();
    const restricted = current.filter((name) => allowed.has(name));
    if (restricted.length === current.length) return;
    // Narrow from the live active set so a persistent mode keeps covering tools
    // that another extension activates later, without re-adding anything.
    pi.setActiveTools(restricted);
  }

  function acquire(request: PiAskGuardAcquireRequest): PiAskGuardAcquireResult {
    const rules = normalizeRules(request.allowedTools);
    if (shuttingDown) return { status: "rejected", reason: "activation-failed" };
    if (
      typeof request.ownerId !== "string"
      || !request.ownerId.trim()
      || !rules
      || (request.startsRun !== undefined && typeof request.startsRun !== "boolean")
      || (request.persistent !== undefined && typeof request.persistent !== "boolean")
      || (request.sessionId !== undefined && (typeof request.sessionId !== "string" || !request.sessionId.trim()))
    ) {
      return { status: "rejected", reason: "invalid-request" };
    }
    if (!hasTrustedProvenance(pi, rules)) {
      return { status: "rejected", reason: "activation-failed" };
    }
    if (active) {
      return { status: "rejected", ownerId: active.ownerId, reason: "busy" };
    }

    const toolsBeforeGuard = pi.getActiveTools();
    const allowedNames = new Set(rules.map((rule) => rule.name));
    const activeTools = toolsBeforeGuard.filter((name) => allowedNames.has(name));
    try {
      pi.setActiveTools(activeTools);
    } catch {
      return { status: "rejected", reason: "activation-failed" };
    }
    active = {
      ownerId: request.ownerId,
      generation: nextGeneration++,
      acquisitionToken: `pi-ask-guard-${randomUUID()}`,
      rules,
      toolsBeforeGuard,
      ...(request.context ? { context: request.context } : {}),
      persistent: request.persistent === true,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    };
    if (request.startsRun) recordRun(active.generation);
    return { status: "active", ownerId: request.ownerId, acquisitionToken: active.acquisitionToken, activeTools };
  }

  pi.events.on(PI_ASK_GUARD_ACQUIRE_EVENT, (event: unknown) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    const request = event as PiAskGuardAcquireRequest;
    request.response = acquire(request);
  });

  pi.events.on(PI_ASK_GUARD_RELEASE_EVENT, (event: unknown) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    const request = event as PiAskGuardReleaseRequest;
    request.released = typeof request.ownerId === "string"
      && typeof request.acquisitionToken === "string"
      && release(request.ownerId, request.acquisitionToken);
  });

  pi.events.on(PI_ASK_GUARD_RUN_START_EVENT, () => {
    if (!shuttingDown) recordRun(active?.generation);
  });

  pi.events.on(PI_ASK_GUARD_PROBE_EVENT, (event: unknown) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    const request = event as PiAskGuardProbeRequest;
    request.available = true;
    request.protocolVersion = 1;
    request.active = active !== undefined;
  });

  pi.on("tool_call", (event) => {
    if (!active) return;
    const permittedRule = active.rules.find((rule) =>
      rule.name === event.toolName && ruleMatchesInput(rule, event.input)
    );
    if (!permittedRule) {
      return {
        block: true,
        reason: `The ${event.toolName} tool is unavailable while the read-only guard is active.`,
      };
    }
    if (permittedRule.equals) {
      try {
        const input = event.input as Record<string, unknown>;
        for (const [field, value] of Object.entries(permittedRule.equals)) {
          Object.defineProperty(input, field, { value, writable: false, configurable: false, enumerable: true });
        }
        Object.defineProperty(event, "input", { value: input, writable: false, configurable: false, enumerable: true });
      } catch {
        return {
          block: true,
          reason: `The ${event.toolName} tool could not be safely constrained for this read-only run.`,
        };
      }
    }
  });

  pi.on("before_agent_start", () => {
    recordRun(active?.generation);
    if (active?.persistent) reassertRestriction();
  });

  // A turn can register and activate a new tool, such as a late MCP connection.
  // Narrow again before the next request of the same run; the per-call check
  // already blocks such a tool.
  pi.on("turn_end", () => {
    if (active?.persistent) reassertRestriction();
  });

  pi.on("agent_start", () => {
    const expectedRun = runs.find((run) => !run.started);
    if (expectedRun) {
      expectedRun.started = true;
      return;
    }
    if (runs.length === 0) runs.push({ guardGeneration: active?.generation, started: true });
  });

  pi.on("agent_settled", (_event, ctx) => {
    const settledGeneration = runs.shift()?.guardGeneration;
    if (settledGeneration === undefined) return;
    if (active?.generation !== settledGeneration) return;
    // Persistent mode survives normal settlement and keeps enforcing until release.
    if (active.persistent) return;
    release(active.ownerId, active.acquisitionToken, ctx);
  });

  pi.on("session_start", (_event, ctx) => {
    shuttingDown = false;
    if (!active?.sessionId) return;
    let currentSessionId: string | undefined;
    try {
      currentSessionId = ctx.sessionManager.getSessionId();
    } catch {
      return;
    }
    if (currentSessionId === active.sessionId) return;
    // Never apply another session's baseline: drop the stale acquisition instead.
    runs.length = 0;
    active = undefined;
  });

  pi.on("session_shutdown", (_event, ctx) => {
    shuttingDown = true;
    runs.length = 0;
    if (active) release(active.ownerId, active.acquisitionToken, ctx, false);
  });

  return {
    acquire,
    release,
    isActive: (ownerId) => !!active && (ownerId === undefined || active.ownerId === ownerId),
    isPersistent: (ownerId) => !!active && active.persistent
      && (ownerId === undefined || active.ownerId === ownerId),
    getContext: () => active?.context,
    getAcquisitionToken: () => active?.acquisitionToken,
  };
}
