/**
 * Where the routing panel keeps its own files, and where Pi keeps the ones it
 * edits.
 *
 * The Herdr mod may only write inside the app home, so the installer and the
 * mod agree on `<app home>/data/pi-routing` for drafts. `HERDR_APP_HOME` wins,
 * then `XDG_CONFIG_HOME`, then `~/.config`, exactly as the mod's `appHome()`
 * resolves them. Pi's own directory follows Pi: `PI_CODING_AGENT_DIR`, else
 * `~/.pi/agent` (see Pi's `config.js`), so a test home stays isolated.
 */
import { homedir } from "node:os";
import { join } from "node:path";
export function hostEnv(env = process.env) {
    return {
        herdrAppHome: env.HERDR_APP_HOME,
        herdrXdg: env.XDG_CONFIG_HOME,
        home: env.HOME,
        agentDir: env.PI_CODING_AGENT_DIR,
    };
}
export function homeDirectory(env) {
    return env.home?.trim() || homedir();
}
export function herdrAppHome(env) {
    const explicit = env.herdrAppHome?.trim();
    if (explicit)
        return explicit;
    const root = env.herdrXdg?.trim() || join(homeDirectory(env), ".config");
    return join(root, "herdr-app");
}
/** Pi's agent directory: `~/.pi/agent` unless `PI_CODING_AGENT_DIR` moves it. */
export function piAgentDir(env) {
    const configured = env.agentDir?.trim();
    if (configured)
        return configured.startsWith("~") ? join(homeDirectory(env), configured.slice(1)) : configured;
    return join(homeDirectory(env), ".pi", "agent");
}
export function modsDirectory(env) {
    return join(herdrAppHome(env), "mods");
}
export function modDirectory(env) {
    return join(modsDirectory(env), "pi-routing");
}
export function layoutsDirectory(env) {
    return join(herdrAppHome(env), "layouts");
}
export function sharedPath(env) {
    return join(herdrAppHome(env), "shared.json");
}
/** Drafts the panel hands to this command: inside the app home, so a mod can write them. */
export function dataDirectory(env) {
    return join(herdrAppHome(env), "data", "pi-routing");
}
export function settingsPath(env) {
    return join(piAgentDir(env), "settings.json");
}
