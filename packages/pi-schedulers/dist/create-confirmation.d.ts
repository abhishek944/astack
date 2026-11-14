/** Full, scrollable human preview; no model-supplied approval value is accepted. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
export declare function confirmCreation(ctx: ExtensionContext, preview: string, signal: AbortSignal): Promise<"Create" | undefined>;
