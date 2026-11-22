/**
 * What the Routing panel shows: the models Pi can use right now, and what the
 * stored `enabledModels` list resolves to.
 *
 * Read through Pi's own settings manager and model runtime, offline, in a short
 * lived process — the same boundary the Schedulers panel uses. Nothing here
 * writes, signs in, or decides anything: `enabledModels` is Pi's list, and the
 * resolution is Pi's answer to what each stored entry switches on.
 */
import type { ScopedEntry, SelectionView } from "../core/selection.js";
import { type HostEnv } from "./paths.js";
export interface AvailableModel {
    provider: string;
    id: string;
    name: string;
}
export interface Selection {
    /** The stored list, verbatim. Empty means every available model. */
    entries: string[];
    resolution: ScopedEntry[];
    /** sha256 of settings.json, or null when there is no file yet. */
    hash: string | null;
    path: string;
}
export type ModelsRead = {
    ok: true;
    available: AvailableModel[];
    selection: Selection;
} | {
    ok: false;
    error: string;
};
export declare function readModels(env: HostEnv): Promise<ModelsRead>;
/** The view the staging rules in `core/selection` work on. */
export declare function selectionView(read: Extract<ModelsRead, {
    ok: true;
}>): SelectionView;
