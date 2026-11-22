/**
 * Writing `enabledModels` back to Pi's settings.
 *
 * Only that one key changes. Every other key keeps its value and its position,
 * the file stays in Pi's own two-space format, and the write is refused when the
 * file is no longer the one the panel read.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { settingsPath } from "./paths.js";
import { hashText } from "./policy.js";
export async function writeEnabledModels(env, patterns, expectedHash) {
    const path = settingsPath(env);
    let text = null;
    try {
        text = await readFile(path, "utf8");
    }
    catch {
        text = null;
    }
    if ((text === null ? null : hashText(text)) !== expectedHash) {
        return { ok: false, error: "Pi's settings changed on disk since this panel loaded them. Reload Routing, then reapply your edits." };
    }
    let settings = {};
    if (text !== null) {
        try {
            settings = JSON.parse(text);
        }
        catch {
            return { ok: false, error: "Pi's settings.json is not valid JSON; nothing was written. Fix it, then reload Routing." };
        }
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        return { ok: false, error: "Pi's settings.json is not a JSON object; nothing was written." };
    }
    const next = { ...settings, enabledModels: patterns };
    const output = JSON.stringify(next, null, 2);
    const temporary = `${path}.pi-routing-${process.pid}.tmp`;
    await writeFile(temporary, output, "utf8");
    await rename(temporary, path);
    return { ok: true, path, hash: hashText(output) };
}
