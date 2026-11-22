import { type RoutingPolicy } from "../core/policy.js";
import { type HostEnv } from "./paths.js";
export declare const POLICY_SKILL = "model-routing-policy";
export declare function hashText(text: string): string;
/** Every place the routing skill can live, most specific first. */
export declare function policyPath(env: HostEnv): Promise<string | null>;
export type PolicyRead = {
    ok: true;
    path: string;
    hash: string;
    policy: RoutingPolicy;
} | {
    ok: false;
    path: string | null;
    error: string;
};
export declare function readPolicy(env: HostEnv): Promise<PolicyRead>;
export type PolicyWrite = {
    ok: true;
    path: string;
    hash: string;
} | {
    ok: false;
    error: string;
};
/** Apply the panel's rules to the policy file as it exists at save time. */
export declare function writePolicy(env: HostEnv, draft: RoutingPolicy): Promise<PolicyWrite>;
