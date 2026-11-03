/** Herdr Core lifecycle tools and bundled coordination skill for Pi. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentTools } from "./tools.js";

const AGENT_TOOLS = ["AgentCreate", "AgentList", "AgentStatus", "AgentOutput", "AgentSend", "AgentInterrupt", "AgentClose", "AgentFocus"];

export default function herdrExtension(pi: ExtensionAPI): void {
  let registered = false;
  let migrationError: string | undefined;
  // Runtime tool discovery is unavailable in the factory. All factories have loaded
  // by session_start, so legacy pi-tasks is detected regardless of package order.
  pi.on("session_start", (_event, ctx) => {
    if (registered) return;
    const duplicates = pi.getAllTools().filter((tool) => AGENT_TOOLS.includes(tool.name));
    if (duplicates.length) {
      migrationError = `pi-herdr cannot register duplicate Agent tools: ${duplicates.map((tool) => tool.name).join(", ")}. Replace legacy pi-tasks with the coordinated compatible local source that provides the delegation bridge and no Agent tools; remove duplicate extension/package sources, then /reload or restart Pi. No tools were overridden.`;
      ctx.ui.notify(migrationError, "error");
      throw new Error(migrationError);
    }
    registerAgentTools(pi);
    registered = true;
  });
  pi.on("tool_call", (event) => {
    if (migrationError && AGENT_TOOLS.includes(event.toolName)) return { block: true, reason: migrationError };
  });
}
