import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
interface Assignment {
    workId: string;
    taskId: string;
}
export interface DelegationAPI {
    prepare(ctx: ExtensionContext, input: Assignment & {
        taskDir: string;
    }): Promise<{
        reportPath: string;
    }>;
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
export declare function requireMainWork(pi: ExtensionAPI): void;
export {};
