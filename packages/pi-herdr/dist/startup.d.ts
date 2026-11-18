/** One structured MonitorList summary; callers must not parse monitor command text. */
export interface MonitorSummary {
    id: string;
    status: "running" | "completed" | "error" | "stopped";
    hcTerminalId?: string;
    description?: string;
    subscriptionReady?: boolean;
}
export type MonitorCall = (name: string, args: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
export interface EnsureSubscriptionInput {
    terminalId: string;
    taskId: string;
    onSignal: string;
    onDone?: string;
}
export interface SubscriptionResult {
    monitorId: string;
    reused: boolean;
    replaced?: string;
}
/**
 * Ensure exactly one ready Core subscription exists for a worker. A ready monitor is reused;
 * a running monitor that never reported ready is stopped before a replacement is created so a
 * resume cannot leave two live subscriptions for one terminal.
 */
export declare function ensureCoreSubscription(call: MonitorCall, input: EnsureSubscriptionInput, signal?: AbortSignal): Promise<SubscriptionResult>;
export interface OwnedWorker {
    terminalId: string;
    state: string;
    statusApp?: string;
    statusState?: string;
    /** Original presentation space label from an AgentCreate present:true launch. */
    presentationSpaceId?: string;
    ready: boolean;
}
/**
 * Prove the supplied terminal is the worker this host session launched for this task before any
 * monitor or task mutation. A matching terminal address alone is not ownership.
 */
export declare function inspectOwnedWorker(input: {
    cwd: string;
    parentId: string;
    sessionId: string;
    taskId: string;
    terminalId: string;
    signal?: AbortSignal;
}): Promise<OwnedWorker>;
