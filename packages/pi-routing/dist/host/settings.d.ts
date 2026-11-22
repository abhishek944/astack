import { type HostEnv } from "./paths.js";
export type SettingsWrite = {
    ok: true;
    path: string;
    hash: string;
} | {
    ok: false;
    error: string;
};
export declare function writeEnabledModels(env: HostEnv, patterns: string[], expectedHash: string | null): Promise<SettingsWrite>;
