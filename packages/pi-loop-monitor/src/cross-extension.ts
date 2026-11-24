/** Versioned event-bus contract shared structurally by cooperating Pi extensions. */

export const MONITOR_ONDONE_REGISTERED_EVENT = "pi-loop-monitor:ondone-registered";
export const MONITOR_STATE_PROBE_EVENT = "pi-loop-monitor:state-probe";

export interface MonitorOnDoneRegistration {
  version: 1;
  toolCallId: string;
  monitorId: string;
  loopId: string;
  /** Core subscriptions have worker-signal wakes, not command-completion waits. */
  kind: "command" | "core";
  sessionGeneration?: number;
}

export type MonitorOnDoneWakeStatus = "waiting" | "queued" | "released" | "stale";

export interface MonitorOnDoneWakeState {
  /** True while the wake still owns resumption: loop active or completion queued. */
  active: boolean;
  status: MonitorOnDoneWakeStatus;
  monitorStatus?: "running" | "completed" | "error" | "stopped";
  loopStatus?: "active" | "paused";
}

export interface MonitorStateAPI {
  getOnDoneWake(input: { monitorId: string; loopId: string }): MonitorOnDoneWakeState;
}

export interface MonitorStateProbe {
  version: 1;
  respond(api: MonitorStateAPI): void;
}
