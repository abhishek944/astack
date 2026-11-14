/**
 * Where the scheduler keeps its state.
 *
 * The Herdr mod can only write inside the app home, so the store lives there
 * and both sides agree on the same files. `HERDR_APP_HOME` wins, then
 * `XDG_CONFIG_HOME`, then `~/.config`; the mod's `appHome()` resolves the same
 * way, so a second app home (another window or a test home) gets its own store.
 *
 * Layout under `<app home>/data/pi-schedulers/`:
 *   tasks/<taskId>.json    one task definition, written by any authoring path
 *   state/<taskId>.json    run state, including authoring schedule/run requests
 *   locks/<taskId>.json    exclusive mutation/dispatch ownership (never expires)
 *   claims/<taskId>.json   legacy claims, retained but no longer used
 */
import { homedir } from "node:os";
import { join } from "node:path";
export function herdrAppHome(env = process.env) {
    const explicit = env.HERDR_APP_HOME?.trim();
    if (explicit)
        return explicit;
    const root = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".config");
    return join(root, "herdr-app");
}
export function schedulerDirectory(env = process.env) {
    return join(herdrAppHome(env), "data", "pi-schedulers");
}
export function tasksDirectory(env = process.env) {
    return join(schedulerDirectory(env), "tasks");
}
export function statesDirectory(env = process.env) {
    return join(schedulerDirectory(env), "state");
}
export function locksDirectory(env = process.env) {
    return join(schedulerDirectory(env), "locks");
}
export function lockPath(taskId, env = process.env) {
    return join(locksDirectory(env), `${taskId}.json`);
}
export function claimsDirectory(env = process.env) {
    return join(schedulerDirectory(env), "claims");
}
export function taskPath(taskId, env = process.env) {
    return join(tasksDirectory(env), `${taskId}.json`);
}
export function statePath(taskId, env = process.env) {
    return join(statesDirectory(env), `${taskId}.json`);
}
export function claimPath(taskId, env = process.env) {
    return join(claimsDirectory(env), `${taskId}.json`);
}
export function modsDirectory(env = process.env) {
    return join(herdrAppHome(env), "mods");
}
export function modDirectory(env = process.env) {
    return join(modsDirectory(env), "pi-schedulers");
}
export function layoutsDirectory(env = process.env) {
    return join(herdrAppHome(env), "layouts");
}
export function sharedPath(env = process.env) {
    return join(herdrAppHome(env), "shared.json");
}
