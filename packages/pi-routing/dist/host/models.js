/**
 * What the Routing panel shows: the models Pi can use right now, and what the
 * stored `enabledModels` list resolves to.
 *
 * Read through Pi's own settings manager and model runtime, offline, in a short
 * lived process — the same boundary the Schedulers panel uses. Nothing here
 * writes, signs in, or decides anything: `enabledModels` is Pi's list, and the
 * resolution is Pi's answer to what each stored entry switches on.
 */
import { readFile } from "node:fs/promises";
import { ModelRuntime, resolveModelScopeWithDiagnostics, SettingsManager } from "@earendil-works/pi-coding-agent";
import { homeDirectory, piAgentDir, settingsPath } from "./paths.js";
import { hashText } from "./policy.js";
export async function readModels(env) {
    const path = settingsPath(env);
    let hash = null;
    try {
        hash = hashText(await readFile(path, "utf8"));
    }
    catch {
        hash = null;
    }
    const previousOffline = process.env.PI_OFFLINE;
    process.env.PI_OFFLINE = "1";
    try {
        const settings = SettingsManager.create(homeDirectory(env), piAgentDir(env), { projectTrusted: false });
        const runtime = await ModelRuntime.create({ allowModelNetwork: false });
        const available = (await runtime.getAvailable()).map((model) => ({ provider: model.provider, id: model.id, name: model.name }));
        const entries = [...(settings.getEnabledModels() ?? [])];
        const resolution = [];
        for (const pattern of entries) {
            const resolved = await resolveModelScopeWithDiagnostics([pattern], runtime);
            resolution.push({ pattern, keys: resolved.scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`) });
        }
        return { ok: true, available, selection: { entries, resolution, hash, path } };
    }
    catch {
        // A prompt, a session or a failed provider must not put its detail on screen.
        return { ok: false, error: "Could not read Pi's models. Check Pi's provider configuration, then reload Routing." };
    }
    finally {
        if (previousOffline === undefined)
            delete process.env.PI_OFFLINE;
        else
            process.env.PI_OFFLINE = previousOffline;
    }
}
/** The view the staging rules in `core/selection` work on. */
export function selectionView(read) {
    return {
        entries: read.selection.entries,
        resolution: read.selection.resolution,
        available: read.available.map((model) => `${model.provider}/${model.id}`),
    };
}
