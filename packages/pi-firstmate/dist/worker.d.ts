/**
 * Narrow, local Core worker classification for First Mate.
 *
 * `HC_TERMINAL_ID` is present in every Core-hosted Pi process, including the
 * primary coordinator, so it is only a precondition. A worker is verified from
 * the labels that pi-herdr AgentCreate writes: `pi.task` and `pi.session`.
 * Partial labels or a failed lookup are reported as unknown instead of guessed.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type WorkerClassification = {
    kind: "explicit-worker";
} | {
    kind: "not-core";
} | {
    kind: "primary";
    terminalId: string;
} | {
    kind: "worker";
    terminalId: string;
    task: string;
    parentSessionId: string;
    parent?: string;
} | {
    kind: "unknown";
    terminalId: string;
    message: string;
};
type CoreExec = Pick<ExtensionAPI, "exec">;
/**
 * Classify the current process as a primary Core session, a verified task
 * worker, a non-Core session, or unknown when the Core lookup cannot be trusted.
 */
export declare function classifyCoreWorker(pi: CoreExec, env?: NodeJS.ProcessEnv): Promise<WorkerClassification>;
export {};
