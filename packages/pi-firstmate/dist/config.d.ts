/**
 * Validation for the `pi-firstmate` section of Pi's effective settings.
 *
 * Pi owns settings loading, project trust and global/project merging, so the
 * extension reads the merged object from `pi.getSettings()` and validates only
 * the section it owns. Unknown sibling keys are ignored for forward compatibility.
 */
export declare const FIRST_MATE_SETTINGS_KEY = "pi-firstmate";
export type ConfiguredDefault = {
    kind: "valid";
    enabled: boolean;
    banner: boolean;
    bannerProblem?: string;
} | {
    kind: "invalid";
    message: string;
};
/**
 * Resolve the configured default.
 *
 * A missing section, a missing `enabled`, or an empty section means `false`.
 * A malformed section or `enabled` is reported instead of silently enabling
 * coordinator mode. A malformed optional `banner` disables only the banner and
 * keeps the valid `enabled` value; the problem is carried as a diagnostic.
 */
export declare function readConfiguredDefault(settings: unknown): ConfiguredDefault;
