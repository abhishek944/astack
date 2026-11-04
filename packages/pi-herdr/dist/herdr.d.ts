export declare const TERMINAL_ID: RegExp;
export declare function object(value: unknown): Record<string, unknown> | undefined;
export declare function cliText(command: "hc" | "herdr-app", args: string[], cwd: string, signal?: AbortSignal, timeout?: number): Promise<string>;
export declare function hc(args: string[], cwd: string, signal?: AbortSignal, timeout?: number): Promise<Record<string, unknown>>;
export declare function app(args: string[], cwd: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
/**
 * Verify and name the app tab that adopted a presented worker. Optional presentation only:
 * a Core-only worker never calls this, and the caller owns a failure here.
 */
export declare function nameWorkerTab(input: {
    terminalId: string;
    spaceId: string;
    parentTabId: string;
    taskId: string;
    cwd: string;
    signal?: AbortSignal;
}): Promise<string>;
export declare function terminalTab(inventory: Record<string, unknown>, terminalId: string): {
    spaceId: string;
    tabId: string;
    name: string;
    terminalCount: number;
} | undefined;
