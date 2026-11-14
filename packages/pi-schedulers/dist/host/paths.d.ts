export interface AppHomeEnv {
    HERDR_APP_HOME?: string | undefined;
    XDG_CONFIG_HOME?: string | undefined;
    HOME?: string | undefined;
}
export declare function herdrAppHome(env?: AppHomeEnv): string;
export declare function schedulerDirectory(env?: AppHomeEnv): string;
export declare function tasksDirectory(env?: AppHomeEnv): string;
export declare function statesDirectory(env?: AppHomeEnv): string;
export declare function locksDirectory(env?: AppHomeEnv): string;
export declare function lockPath(taskId: string, env?: AppHomeEnv): string;
export declare function claimsDirectory(env?: AppHomeEnv): string;
export declare function taskPath(taskId: string, env?: AppHomeEnv): string;
export declare function statePath(taskId: string, env?: AppHomeEnv): string;
export declare function claimPath(taskId: string, env?: AppHomeEnv): string;
export declare function modsDirectory(env?: AppHomeEnv): string;
export declare function modDirectory(env?: AppHomeEnv): string;
export declare function layoutsDirectory(env?: AppHomeEnv): string;
export declare function sharedPath(env?: AppHomeEnv): string;
