/**
 * The Pi side: `/schedulers` authoring and inspection.
 *
 * This extension never starts a timer, because a Pi session is not the host:
 * the Herdr mod owns the clock so that scheduled runs stop with the app. Here
 * a "run" is a request the dispatcher honours on its next tick, and it is
 * refused outright when no Herdr window answers.
 *
 * Every write touches one task's definition file (and, when the schedule moves,
 * that task's run-state file) through the same store the mod and the CLI use.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare function registerSchedulers(pi: ExtensionAPI): void;
