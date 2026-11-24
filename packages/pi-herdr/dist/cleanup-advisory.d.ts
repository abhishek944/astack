import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Add a one-shot cleanup advisory to a completed delegate task's normal TodoUpdate result.
 * It is advisory only: no command, interrupt, close, status change, or worker registry.
 */
export declare function registerCleanupAdvisory(pi: ExtensionAPI): void;
