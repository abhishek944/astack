export interface LayoutNode {
    id?: string;
    type?: string;
    content?: {
        mod?: string;
        props?: Record<string, unknown>;
    };
    children?: LayoutNode[];
    size?: unknown;
    window_drag?: boolean;
    [key: string]: unknown;
}
export interface InstallAsset {
    relative: string;
    contents: Buffer;
}
export interface InstallOptions {
    env?: NodeJS.ProcessEnv;
    layout?: string;
    force?: boolean;
    /** Skip the `herdr-app check` load test. */
    skipCheck?: boolean;
}
export interface Migration {
    tasks: number;
    problems: string[];
    keptAt: string | null;
}
export interface InstallReport {
    appHome: string;
    modDirectory: string;
    written: string[];
    identical: string[];
    drifted: string[];
    removed: string[];
    layout: {
        name: string;
        path: string | null;
        backup: string | null;
        changed: boolean;
        note: string;
    };
    check: {
        ran: boolean;
        ok: boolean;
        output: string;
    };
    migration: Migration;
}
export declare function sourceDirectory(): Promise<string>;
/** The block that makes the mod visible; its absence is why the mod never starts. */
export declare function hasSchedulersBar(root: LayoutNode): boolean;
/** Add a choice to the native panel, never a separate pane or floating fallback. */
export declare function patchLayout(root: LayoutNode): {
    root: LayoutNode;
    changed: boolean;
    note: string;
};
export declare function installSchedulers(options?: InstallOptions): Promise<InstallReport>;
