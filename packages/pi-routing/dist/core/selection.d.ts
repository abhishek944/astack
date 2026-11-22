/**
 * Staging for Pi's `enabledModels` list.
 *
 * The stored list is kept verbatim and interpreted the way Pi interprets it:
 * exact `provider/id` entries, fuzzy matches, case-insensitive globs and an
 * optional `:<thinking>` suffix. An empty or missing list means every
 * available model, never none.
 *
 * `resolution` is what Pi resolved each stored entry to. A toggle therefore
 * works on real models instead of on the text of a pattern: an exact entry is
 * removed on its own, and an entry that also covers other models is replaced by
 * the exact ids it still covers, with its thinking suffix carried over.
 * Entries that resolve to nothing are kept until they are switched off by
 * their own text, which is the only handle the list has for them.
 */
export interface ScopedEntry {
    /** The stored text, exactly as Pi received it. */
    pattern: string;
    /** The `provider/id` models it resolved to. */
    keys: string[];
}
export interface SelectionView {
    /** The stored list, verbatim. Empty means every available model. */
    entries: string[];
    resolution: ScopedEntry[];
    /** Every selectable `provider/id`, in Pi's order. */
    available: string[];
}
export interface SelectionSummary {
    enabled: number;
    available: number;
    /** True when the list is empty, so Pi enables everything. */
    all: boolean;
    /** Stored entries that matched no model. */
    unmatched: string[];
}
/** `provider/model:high` → the thinking level, when the suffix really is one. */
export declare function thinkingSuffix(entry: string): string | null;
/** The models a stored entry switches on. */
export declare function enabledKeys(view: SelectionView): Set<string>;
export declare function summarize(view: SelectionView): SelectionSummary;
/**
 * The list after switching one model on or off. `entries` must be the stored
 * list this view was resolved from; the result keeps its order, appends new
 * ids at the end and never drops an entry that still covers something.
 */
export declare function toggleModel(view: SelectionView, key: string, on: boolean): string[];
