/** Supported Langfuse cloud default used when no explicit base URL is set. */
export const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);
/**
 * Resolves server-owned configuration from the process environment.
 *
 * Enabled once both keys are configured. `LANGFUSE_ENABLED=false` (or 0/no/off)
 * wins over keys. Missing keys make the extension inert. Unknown capture values
 * fall back to the metadata-only default.
 */
export function resolveLangfuseConfig(env = process.env) {
    if (isExplicitlyDisabled(env.LANGFUSE_ENABLED))
        return undefined;
    const publicKey = trimmed(env.LANGFUSE_PUBLIC_KEY);
    const secretKey = trimmed(env.LANGFUSE_SECRET_KEY);
    if (!publicKey || !secretKey)
        return undefined;
    const config = {
        publicKey,
        secretKey,
        capture: captureMode(env.PI_LANGFUSE_CAPTURE),
    };
    const baseUrl = trimmed(env.LANGFUSE_BASE_URL);
    if (baseUrl)
        config.baseUrl = baseUrl;
    const environment = trimmed(env.LANGFUSE_TRACING_ENVIRONMENT);
    if (environment)
        config.environment = environment;
    const release = trimmed(env.LANGFUSE_RELEASE);
    if (release)
        config.release = release;
    return config;
}
/**
 * Makes every exporter-relevant field concrete so the Langfuse SDK never falls
 * back to ambient environment values. Empty labels intentionally block the SDK's
 * `??` fallbacks for environment and release.
 */
export function normalizeLangfuseConfig(config) {
    return {
        ...config,
        baseUrl: config.baseUrl ?? DEFAULT_LANGFUSE_BASE_URL,
        environment: config.environment ?? "",
        release: config.release ?? "",
    };
}
function captureMode(value) {
    return trimmed(value)?.toLowerCase() === "full" ? "full" : "metadata";
}
function isExplicitlyDisabled(value) {
    const normalized = trimmed(value)?.toLowerCase();
    return normalized !== undefined && DISABLED_VALUES.has(normalized);
}
function trimmed(value) {
    const result = value?.trim();
    return result ? result : undefined;
}
