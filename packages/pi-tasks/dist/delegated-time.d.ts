import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "./state.js";
export interface TimingInspection {
    reportPath: string;
    timing: "placeholder" | "measured";
    workerSessionId: string | null;
}
/**
 * Validate an existing timing descriptor for a delegated assignment before registration.
 * A fresh descriptor has no worker session or tasks yet; that is a placeholder, not a
 * measurement. Callers must report it as unknown until the worker exports real effort.
 */
export declare function inspectTimingReport(ctx: ExtensionContext, taskDir: string, workId: string, taskId: string, reportPath: string): Promise<TimingInspection>;
export declare function createTimingReport(ctx: ExtensionContext, taskDir: string, workId: string, taskId: string): Promise<string>;
export declare function registerDelegatedTimeTools(pi: ExtensionAPI, state: TaskState): void;
