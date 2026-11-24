import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Keep structural compatibility with pi-tasks; never import its installed internals.
interface Assignment { workId: string; taskId: string }
export interface TimingInspection {
  reportPath: string;
  timing: "placeholder" | "measured";
  workerSessionId: string | null;
}
export interface DelegationAPI {
  prepare(ctx: ExtensionContext, input: Assignment & { taskDir: string }): Promise<{ reportPath: string }>;
  /** Optional in bridge version 1; AgentResume requires it before registering timing. */
  inspect?(ctx: ExtensionContext, input: Assignment & { taskDir: string; reportPath: string }): Promise<TimingInspection>;
  attach(ctx: ExtensionContext, input: Assignment & { terminalId: string; monitorId: string; reportPath: string }): void;
  detach(ctx: ExtensionContext, input: { terminalId: string }): void;
}

export function delegationAPI(pi: ExtensionAPI): DelegationAPI {
  const responses: DelegationAPI[] = [];
  pi.events.emit("pi-tasks:delegation-api", { version: 1, respond(api: DelegationAPI) { responses.push(api); } });
  const api = responses[0];
  if (responses.length !== 1 || !api || typeof api.prepare !== "function" || typeof api.attach !== "function" || typeof api.detach !== "function") {
    throw new Error("pi-herdr requires exactly one compatible pi-tasks delegation bridge (version 1 with prepare/attach/detach). Replace legacy pi-tasks with the coordinated compatible local source, remove duplicate installations, then /reload or restart Pi. Published pi-tasks 0.15.0 does not include this bridge.");
  }
  return api;
}

export function hasMainWork(pi: ExtensionAPI): boolean {
  const active = new Set(pi.getActiveTools());
  return ["WorkCreate", "WorkList", "WorkUpdate", "TodoCreate", "TodoList", "TodoUpdate"].every((name) => active.has(name));
}

export function requireMainWork(pi: ExtensionAPI): void {
  if (!hasMainWork(pi)) throw new Error("Use agent tools in tracked main-conversation work, not /ask or /btw.");
}
