export declare const TERMINAL_ID: RegExp;
export declare function object(value: unknown): Record<string, unknown> | undefined;
export declare function cliText(command: "hc" | "herdr-app", args: string[], cwd: string, signal?: AbortSignal, timeout?: number): Promise<string>;
export declare function hc(args: string[], cwd: string, signal?: AbortSignal, timeout?: number): Promise<Record<string, unknown>>;
export declare function app(args: string[], cwd: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
export declare function terminalTab(inventory: Record<string, unknown>, terminalId: string): {
    spaceId: string;
    tabId: string;
    name: string;
    terminalCount: number;
} | undefined;
