import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Keep structural compatibility with pi-tasks; never import its installed internals.
interface Assignment { workId: string; taskId: string }
export interface DelegationAPI {
  prepare(ctx: ExtensionContext, input: Assignment & { taskDir: string }): Promise<{ reportPath: string }>;
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

export function requireMainWork(pi: ExtensionAPI): void {
  const active = new Set(pi.getActiveTools());
  if (!["WorkCreate", "WorkList", "WorkUpdate", "TodoCreate", "TodoList", "TodoUpdate"].every((name) => active.has(name))) throw new Error("Use agent tools in tracked main-conversation work, not /ask or /btw.");
}
