export interface HostEnv {
    herdrAppHome?: string;
    herdrXdg?: string;
    home?: string;
    agentDir?: string;
}
export declare function hostEnv(env?: NodeJS.ProcessEnv): HostEnv;
export declare function homeDirectory(env: HostEnv): string;
export declare function herdrAppHome(env: HostEnv): string;
/** Pi's agent directory: `~/.pi/agent` unless `PI_CODING_AGENT_DIR` moves it. */
export declare function piAgentDir(env: HostEnv): string;
export declare function modsDirectory(env: HostEnv): string;
export declare function modDirectory(env: HostEnv): string;
export declare function layoutsDirectory(env: HostEnv): string;
export declare function sharedPath(env: HostEnv): string;
/** Drafts the panel hands to this command: inside the app home, so a mod can write them. */
export declare function dataDirectory(env: HostEnv): string;
export declare function settingsPath(env: HostEnv): string;
