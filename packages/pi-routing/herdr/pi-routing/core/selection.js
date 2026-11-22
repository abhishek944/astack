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
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
/** `provider/model:high` → the thinking level, when the suffix really is one. */
export function thinkingSuffix(entry) {
    const colon = entry.lastIndexOf(":");
    if (colon <= 0)
        return null;
    const suffix = entry.slice(colon + 1).toLowerCase();
    return THINKING.has(suffix) ? suffix : null;
}
/** The models a stored entry switches on. */
export function enabledKeys(view) {
    if (view.entries.length === 0)
        return new Set(view.available);
    const keys = new Set();
    for (const entry of view.resolution)
        for (const key of entry.keys)
            keys.add(key);
    return keys;
}
export function summarize(view) {
    const enabled = enabledKeys(view);
    return {
        enabled: enabled.size,
        available: view.available.length,
        all: view.entries.length === 0,
        unmatched: view.entries.filter((pattern) => !view.resolution.some((entry) => entry.pattern === pattern && entry.keys.length > 0)),
    };
}
function covered(entry) {
    return entry?.keys ?? [];
}
/**
 * The list after switching one model on or off. `entries` must be the stored
 * list this view was resolved from; the result keeps its order, appends new
 * ids at the end and never drops an entry that still covers something.
 */
export function toggleModel(view, key, on) {
    const entries = view.entries;
    if (on) {
        if (entries.length === 0)
            return entries;
        if (enabledKeys(view).has(key))
            return entries;
        return [...entries, key];
    }
    // Everything is enabled by an empty list: materialize the rest so one model
    // can be switched off at all. Pi cannot store "none", so an emptied list means
    // "all" again and the panel says so.
    if (entries.length === 0)
        return view.available.filter((model) => model !== key);
    // An entry that resolved to nothing has no catalogue row, so switching it off
    // removes that exact saved text instead of looking for models to keep.
    if (!view.available.includes(key))
        return entries.filter((entry) => entry !== key);
    const next = [];
    for (const entry of entries) {
        const resolved = view.resolution.find((candidate) => candidate.pattern === entry);
        const keys = covered(resolved);
        if (!keys.includes(key)) {
            next.push(entry);
            continue;
        }
        const rest = keys.filter((model) => model !== key);
        if (rest.length === 0)
            continue;
        const suffix = thinkingSuffix(entry);
        for (const model of rest)
            next.push(suffix ? `${model}:${suffix}` : model);
    }
    return next;
}
