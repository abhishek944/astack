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

export interface AppHomeEnv {
  HERDR_APP_HOME?: string | undefined;
  XDG_CONFIG_HOME?: string | undefined;
  HOME?: string | undefined;
}

export function herdrAppHome(env: AppHomeEnv = process.env): string {
  const explicit = env.HERDR_APP_HOME?.trim();
  if (explicit) return explicit;
  const root = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".config");
  return join(root, "herdr-app");
}

export function schedulerDirectory(env: AppHomeEnv = process.env): string {
  return join(herdrAppHome(env), "data", "pi-schedulers");
}

export function tasksDirectory(env: AppHomeEnv = process.env): string {
  return join(schedulerDirectory(env), "tasks");
}

export function statesDirectory(env: AppHomeEnv = process.env): string {
  return join(schedulerDirectory(env), "state");
}

export function locksDirectory(env: AppHomeEnv = process.env): string {
  return join(schedulerDirectory(env), "locks");
}

export function lockPath(taskId: string, env: AppHomeEnv = process.env): string {
  return join(locksDirectory(env), `${taskId}.json`);
}

export function claimsDirectory(env: AppHomeEnv = process.env): string {
  return join(schedulerDirectory(env), "claims");
}

export function taskPath(taskId: string, env: AppHomeEnv = process.env): string {
  return join(tasksDirectory(env), `${taskId}.json`);
}

export function statePath(taskId: string, env: AppHomeEnv = process.env): string {
  return join(statesDirectory(env), `${taskId}.json`);
}

export function claimPath(taskId: string, env: AppHomeEnv = process.env): string {
  return join(claimsDirectory(env), `${taskId}.json`);
}

export function modsDirectory(env: AppHomeEnv = process.env): string {
  return join(herdrAppHome(env), "mods");
}

export function modDirectory(env: AppHomeEnv = process.env): string {
  return join(modsDirectory(env), "pi-schedulers");
}

export function layoutsDirectory(env: AppHomeEnv = process.env): string {
  return join(herdrAppHome(env), "layouts");
}

export function sharedPath(env: AppHomeEnv = process.env): string {
  return join(herdrAppHome(env), "shared.json");
}
