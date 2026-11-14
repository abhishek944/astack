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
export declare function discoverModels(cwd: string): Promise<ModelDiscovery>;
