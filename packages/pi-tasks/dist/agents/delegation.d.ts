import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "../state.js";
/** Task-owned state changes used by pi-herdr's lifecycle tools. */
export declare function registerDelegationBridge(pi: ExtensionAPI, state: TaskState): void;
