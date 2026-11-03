export interface DelegateLink {
    terminalId: string;
}
export declare function delegateLink(taskInfo: string): DelegateLink | undefined;
export declare function focusTerminal(terminalId: string, cwd: string, signal?: AbortSignal): Promise<void>;
export declare function preservePaneLink(current: string, next: string): string;
export declare function withTerminalLink(taskInfo: string, terminalId?: string, monitorId?: string): string;
