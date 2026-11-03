/**
 * Validation for the `pi-firstmate` section of Pi's effective settings.
 *
 * Pi owns settings loading, project trust and global/project merging, so the
 * extension reads the merged object from `pi.getSettings()` and validates only
 * the section it owns. Unknown sibling keys are ignored for forward compatibility.
 */
export const FIRST_MATE_SETTINGS_KEY = "pi-firstmate";
const DEFAULT_OFF = { kind: "valid", enabled: false, banner: true };
function describeValue(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "an array";
    if (typeof value === "string")
        return "a string";
    if (typeof value === "number")
        return "a number";
    if (typeof value === "boolean")
        return "a boolean";
    return typeof value;
}
/**
 * Resolve the configured default.
 *
 * A missing section, a missing `enabled`, or an empty section means `false`.
 * A malformed section or `enabled` is reported instead of silently enabling
 * coordinator mode. A malformed optional `banner` disables only the banner and
 * keeps the valid `enabled` value; the problem is carried as a diagnostic.
 */
export function readConfiguredDefault(settings) {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        return { kind: "invalid", message: "Pi returned settings that are not an object" };
    }
    const section = settings[FIRST_MATE_SETTINGS_KEY];
    if (section === undefined)
        return DEFAULT_OFF;
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
        return {
            kind: "invalid",
            message: `expected "${FIRST_MATE_SETTINGS_KEY}" to be an object such as {"enabled": false}, found ${describeValue(section)}`,
        };
    }
    const enabled = section.enabled;
    if (enabled !== undefined && typeof enabled !== "boolean") {
        return {
            kind: "invalid",
            message: `expected "${FIRST_MATE_SETTINGS_KEY}.enabled" to be true or false, found ${describeValue(enabled)}`,
        };
    }
    const banner = section.banner;
    if (banner !== undefined && typeof banner !== "boolean") {
        return {
            kind: "valid",
            enabled: enabled ?? false,
            banner: false,
            bannerProblem: `expected "${FIRST_MATE_SETTINGS_KEY}.banner" to be true or false, found ${describeValue(banner)}`,
        };
    }
    return { kind: "valid", enabled: enabled ?? false, banner: banner ?? true };
}
