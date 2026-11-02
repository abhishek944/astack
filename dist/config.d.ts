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
} | {
    kind: "invalid";
    message: string;
};
/**
 * Resolve the configured default.
 *
 * A missing section, a missing `enabled`, or an empty section means `false`.
 * A malformed section is reported instead of silently enabling coordinator mode.
 */
export declare function readConfiguredDefault(settings: unknown): ConfiguredDefault;
