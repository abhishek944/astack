import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/** The native header belongs to the layout, not the content mod. Preserve originals. */
export declare function ensureHerdrTasksHeader(ctx: Pick<ExtensionContext, "cwd" | "signal">, home: string): Promise<void>;
