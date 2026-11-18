import { hc, object, TERMINAL_ID } from "./herdr.js";

/** One structured MonitorList summary; callers must not parse monitor command text. */
export interface MonitorSummary {
  id: string;
  status: "running" | "completed" | "error" | "stopped";
  hcTerminalId?: string;
  description?: string;
  subscriptionReady?: boolean;
}

export type MonitorCall = (name: string, args: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;

export interface EnsureSubscriptionInput {
  terminalId: string;
  taskId: string;
  onSignal: string;
  onDone?: string;
}

export interface SubscriptionResult {
  monitorId: string;
  reused: boolean;
  replaced?: string;
}

function monitorSummary(value: unknown): MonitorSummary | undefined {
  const record = object(value);
  if (!record || typeof record.id !== "string" || !["running", "completed", "error", "stopped"].includes(String(record.status))) return undefined;
  return {
    id: record.id,
    status: record.status as MonitorSummary["status"],
    ...(typeof record.hcTerminalId === "string" ? { hcTerminalId: record.hcTerminalId } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    ...(typeof record.subscriptionReady === "boolean" ? { subscriptionReady: record.subscriptionReady } : {}),
  };
}

/**
 * Ensure exactly one ready Core subscription exists for a worker. A ready monitor is reused;
 * a running monitor that never reported ready is stopped before a replacement is created so a
 * resume cannot leave two live subscriptions for one terminal.
 */
export async function ensureCoreSubscription(call: MonitorCall, input: EnsureSubscriptionInput, signal?: AbortSignal): Promise<SubscriptionResult> {
  const listed = await call("MonitorList", {}, signal);
  if (!Array.isArray(listed.monitors)) {
    throw new Error("Update pi-loop-monitor: MonitorList must return structured monitor details so resume can reuse or replace the existing Core subscription without creating a duplicate.");
  }
  const running = listed.monitors
    .map(monitorSummary)
    .filter((monitor): monitor is MonitorSummary => monitor !== undefined && monitor.status === "running" && monitor.hcTerminalId === input.terminalId);
  if (running.length > 1) {
    throw new Error(`Found ${running.length} running Core subscriptions for ${input.terminalId}. Stop the extra monitors before resuming; no new subscription was created.`);
  }
  let replaced: string | undefined;
  if (running.length === 1) {
    const existing = running[0]!;
    if (existing.subscriptionReady === true) return { monitorId: existing.id, reused: true };
    await call("MonitorStop", { monitorId: existing.id }, signal);
    replaced = existing.id;
  }
  const created = await call("MonitorCreate", {
    hcTerminalId: input.terminalId,
    description: `Agent ${input.taskId} (${input.terminalId})`,
    timeout: 0,
    onSignal: input.onSignal,
    ...(input.onDone === undefined ? {} : { onDone: input.onDone }),
  }, signal);
  if (typeof created.monitorId !== "string") throw new Error("Update pi-loop-monitor: MonitorCreate must return details.monitorId.");
  if (created.subscriptionReady !== true) {
    await call("MonitorStop", { monitorId: created.monitorId }, signal);
    throw new Error("Update pi-loop-monitor: MonitorCreate must wait for and report a ready Core subscription; the unverified monitor was stopped.");
  }
  return { monitorId: created.monitorId, reused: false, ...(replaced === undefined ? {} : { replaced }) };
}

export interface OwnedWorker {
  terminalId: string;
  state: string;
  statusApp?: string;
  statusState?: string;
  /** Original presentation space label from an AgentCreate present:true launch. */
  presentationSpaceId?: string;
  ready: boolean;
}

/**
 * Prove the supplied terminal is the worker this host session launched for this task before any
 * monitor or task mutation. A matching terminal address alone is not ownership.
 */
export async function inspectOwnedWorker(input: { cwd: string; parentId: string; sessionId: string; taskId: string; terminalId: string; signal?: AbortSignal }): Promise<OwnedWorker> {
  if (!TERMINAL_ID.test(input.parentId)) throw new Error("AgentResume requires a real HC_TERMINAL_ID from Core.");
  const parent = await hc(["get", input.parentId], input.cwd, input.signal);
  if (parent.state !== "live") throw new Error("The Core parent terminal is not live.");
  const terminal = await hc(["get", input.terminalId], input.cwd, input.signal);
  if (terminal.parent !== input.parentId) throw new Error("Refusing to resume: the terminal is not a child of this host terminal.");
  const labels = object(terminal.labels);
  if (labels?.["pi.task"] !== input.taskId || labels?.["pi.session"] !== input.sessionId) {
    throw new Error("Refusing to resume: the terminal labels do not match this session and task.");
  }
  const status = object(terminal.status);
  const statusApp = typeof status?.app === "string" ? status.app : undefined;
  const statusState = typeof status?.state === "string" ? status.state : undefined;
  const presentationSpaceId = typeof labels?.["herdr.space"] === "string" && labels["herdr.space"] ? labels["herdr.space"] : undefined;
  const state = typeof terminal.state === "string" ? terminal.state : "unknown";
  return {
    terminalId: input.terminalId,
    state,
    ...(statusApp === undefined ? {} : { statusApp }),
    ...(statusState === undefined ? {} : { statusState }),
    ...(presentationSpaceId === undefined ? {} : { presentationSpaceId }),
    ready: state === "live" && statusApp === "pi" && statusState === "idle",
  };
}
