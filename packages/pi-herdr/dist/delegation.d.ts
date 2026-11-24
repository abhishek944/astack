import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
interface Assignment {
    workId: string;
    taskId: string;
}
export interface TimingInspection {
    reportPath: string;
    timing: "placeholder" | "measured";
    workerSessionId: string | null;
}
export interface DelegationAPI {
    prepare(ctx: ExtensionContext, input: Assignment & {
        taskDir: string;
    }): Promise<{
        reportPath: string;
    }>;
    /** Optional in bridge version 1; AgentResume requires it before registering timing. */
    inspect?(ctx: ExtensionContext, input: Assignment & {
        taskDir: string;
        reportPath: string;
    }): Promise<TimingInspection>;
    attach(ctx: ExtensionContext, input: Assignment & {
        terminalId: string;
        monitorId: string;
        reportPath: string;
    }): void;
    detach(ctx: ExtensionContext, input: {
        terminalId: string;
    }): void;
}
export declare function delegationAPI(pi: ExtensionAPI): DelegationAPI;
export declare function hasMainWork(pi: ExtensionAPI): boolean;
export declare function requireMainWork(pi: ExtensionAPI): void;
export {};
