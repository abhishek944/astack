/** Local configured Pi metadata and launch policy. No session, prompt, request auth or catalog network. */
import { createAgentSessionServices, getAgentDir, hasTrustRequiringProjectResources, ModelRuntime, ProjectTrustStore, resolveModelScopeWithDiagnostics, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ModelMetadata {
  provider: string;
  id: string;
  name: string;
}

export interface LaunchPolicy {
  ready: boolean;
  firstMateWorker: boolean;
  trust: "not-required" | "saved" | "default" | "required" | "unavailable";
  error?: string;
}

export interface ModelDiscovery {
  models: ModelMetadata[];
  launch: LaunchPolicy;
  defaultModel?: string;
  scopedModels?: string[];
  error?: string;
}

/** The native caller uses a short-lived CLI process; preserve the environment for other callers too. */
export async function discoverModels(cwd: string): Promise<ModelDiscovery> {
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  const models: ModelMetadata[] = [];
  let launch: LaunchPolicy = {
    ready: false,
    firstMateWorker: false,
    trust: "unavailable",
    error: "Could not inspect Pi startup configuration. Check Pi before retrying this scheduled run.",
  };
  try {
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
    const protectedResources = hasTrustRequiringProjectResources(cwd);
    const savedTrust = protectedResources ? new ProjectTrustStore(agentDir).get(cwd) : null;
    const defaultTrust = settingsManager.getDefaultProjectTrust();
    const projectTrusted = !protectedResources || savedTrust === true || (savedTrust === null && defaultTrust === "always");
    const trust: LaunchPolicy["trust"] = !protectedResources ? "not-required" : savedTrust === true ? "saved" : projectTrusted ? "default" : "required";
    settingsManager.setProjectTrusted(projectTrusted);
    const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderOptions: {
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        disabledBuiltinExtensions: ["mcp"],
      },
    });
    // Load the normal global and already-trusted project provider factories, without
    // creating/binding a session or starting MCP. A missing trust grant is never invented.
    const extensions = services.resourceLoader.getExtensions();
    const extensionError = extensions.errors.length > 0 || settingsManager.drainErrors().length > 0;
    const firstMateWorker = extensions.extensions.some((extension) => extension.flags.get("firstmate-worker")?.type === "boolean");
    launch = {
      ready: projectTrusted && !extensionError,
      firstMateWorker,
      trust,
      ...(!projectTrusted ? { error: `Project trust is required for ${cwd}. Open Pi there and grant the intended folder or parent trust, then retry. No run was started.` }
        : extensionError ? { error: "Pi extensions or settings could not be loaded. Fix Pi configuration before retrying this scheduled run." } : {}),
    };
    const refresh = await modelRuntime.refresh({ allowNetwork: false });
    models.push(...modelRuntime.getAvailableSnapshot().map(({ provider, id, name }) => ({ provider, id, name })));
    const available = await modelRuntime.getAvailable();
    models.splice(0, models.length, ...available.map(({ provider, id, name }) => ({ provider, id, name })));
    const patterns = settingsManager.getEnabledModels();
    const scope = patterns?.length ? await resolveModelScopeWithDiagnostics(patterns, modelRuntime) : undefined;
    const scopedModels = scope?.scopedModels.map(({ model }) => `${model.provider}/${model.id}`);
    const provider = settingsManager.getDefaultProvider();
    const id = settingsManager.getDefaultModel();
    const defaultModel = provider && id ? `${provider}/${id}` : undefined;
    const failed = refresh.errors.size > 0 || modelRuntime.getError() || extensionError || services.diagnostics.some((item) => item.type === "error");
    return {
      models,
      launch,
      ...(defaultModel ? { defaultModel } : {}),
      ...(scopedModels?.length ? { scopedModels } : {}),
      ...(failed ? { error: "Some Pi model metadata could not be refreshed. Retry after checking your Pi provider configuration." } : {}),
    };
  } catch {
    // Foreign exceptions can contain configuration paths or credentials. Never return them.
    return { models, launch, error: "Could not load Pi models. Check your Pi provider configuration, then Retry." };
  } finally {
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
  }
}
