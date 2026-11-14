/** pi-schedulers: scheduled Pi runs, hosted by the running Herdr app. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI): void;
export * from "./core/index.js";
export { appReachable } from "./host/app.js";
export { main as runCli } from "./host/cli.js";
export { installSchedulers, patchLayout } from "./host/install.js";
export { claimPath, claimsDirectory, herdrAppHome, layoutsDirectory, lockPath, locksDirectory, modDirectory, schedulerDirectory, statePath, statesDirectory, taskPath, tasksDirectory, } from "./host/paths.js";
export { changeTask, loadSnapshot, saveTask } from "./host/store.js";
