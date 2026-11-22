import { type HostEnv } from "./paths.js";
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
    cloned_from?: unknown;
    [key: string]: unknown;
}
export interface InstallAsset {
    relative: string;
    contents: Buffer;
}
export interface InstallOptions extends HostEnv {
    layout?: string;
    force?: boolean;
    skipCheck?: boolean;
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
}
export declare function sourceDirectory(): Promise<string>;
export declare function hasRoutingBar(root: LayoutNode): boolean;
/** Add a choice to the native panel, never a separate pane or floating fallback. */
export declare function patchLayout(root: LayoutNode): {
    root: LayoutNode;
    changed: boolean;
    note: string;
};
export declare function installRouting(options?: InstallOptions): Promise<InstallReport>;
