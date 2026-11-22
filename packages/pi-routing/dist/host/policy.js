/**
 * The `model-routing-policy` skill, and the JSON block inside it.
 *
 * The skill is found where Pi would find it: a user copy in the agent
 * directory, otherwise the package that ships it. A save re-reads the current
 * file and replaces only its ```json block: the panel's rules are applied to
 * whatever the skill says now, while frontmatter, prose and notes stay as they
 * are. An edit made elsewhere can therefore never look like a stale conflict.
 */
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePolicyBody, replacePolicyBody } from "../core/policy.js";
import { homeDirectory, piAgentDir } from "./paths.js";
export const POLICY_SKILL = "model-routing-policy";
export function hashText(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}
/** Installed Pi packages, as settings.json lists them (npm entries carry no path). */
async function packageDirectories(env) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(join(piAgentDir(env), "settings.json"), "utf8"));
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed.packages))
        return [];
    const home = homeDirectory(env);
    return parsed.packages.flatMap((entry) => {
        if (typeof entry !== "string" || entry.startsWith("npm:") || entry.startsWith("git:"))
            return [];
        return [entry.startsWith("~/") ? join(home, entry.slice(2)) : entry];
    });
}
async function firstExisting(paths) {
    for (const path of paths) {
        try {
            const text = await readFile(path, "utf8");
            if (text.includes("name:"))
                return path;
        }
        catch {
            // Try the next place Pi could be loading it from.
        }
    }
    return null;
}
/** Every place the routing skill can live, most specific first. */
export async function policyPath(env) {
    const candidates = [join(piAgentDir(env), "skills", POLICY_SKILL, "SKILL.md")];
    for (const directory of await packageDirectories(env))
        candidates.push(join(directory, "skills", POLICY_SKILL, "SKILL.md"));
    candidates.push(join(homeDirectory(env), ".agents", "skills", POLICY_SKILL, "SKILL.md"));
    return firstExisting(candidates);
}
export async function readPolicy(env) {
    const path = await policyPath(env);
    if (!path) {
        return {
            ok: false,
            path: null,
            error: `No ${POLICY_SKILL} skill was found. Install the pi-herdr package that ships it, then reload the panel.`,
        };
    }
    let text;
    try {
        text = await readFile(path, "utf8");
    }
    catch {
        return { ok: false, path, error: `Cannot read ${path}.` };
    }
    const parsed = parsePolicyBody(text);
    if (!parsed.ok)
        return { ok: false, path, error: parsed.error };
    return { ok: true, path, hash: hashText(text), policy: parsed.policy };
}
/** Apply the panel's rules to the policy file as it exists at save time. */
export async function writePolicy(env, draft) {
    const path = await policyPath(env);
    if (!path)
        return { ok: false, error: `No ${POLICY_SKILL} skill was found.` };
    let text;
    try {
        text = await readFile(path, "utf8");
    }
    catch {
        return { ok: false, error: `Cannot read ${path}.` };
    }
    const parsed = parsePolicyBody(text);
    if (!parsed.ok)
        return { ok: false, error: parsed.error };
    // Notes are written by the skill, not edited in the panel. Take them from
    // the current file so an external edit to the guidance survives this save.
    const next = replacePolicyBody(text, parsed.block, { rules: draft.rules, notes: parsed.policy.notes });
    if (!parsePolicyBody(next).ok)
        return { ok: false, error: "The edited policy would not read back; nothing was written." };
    const temporary = `${path}.pi-routing-${process.pid}.tmp`;
    await writeFile(temporary, next, "utf8");
    await rename(temporary, path);
    return { ok: true, path, hash: hashText(next) };
}
