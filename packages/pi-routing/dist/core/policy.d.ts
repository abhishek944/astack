/**
 * The routing policy as it is stored in the `model-routing-policy` skill.
 *
 * One ```json block in the skill's Markdown body holds the policy. Nothing else
 * in the file is ours: the frontmatter, the title and the surrounding prose are
 * carried through a save untouched. The block keeps the table's order, its
 * model / when / thinking / fast values, and the guidance below the old table
 * verbatim as `notes` — this module never rewrites prose or invents precedence.
 */
export declare const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export declare const FAST_MODES: readonly ["on", "off"];
export type FastMode = (typeof FAST_MODES)[number];
export declare const POLICY_LANGUAGE = "json";
/** One row of the policy: who does the work, and with which model settings. */
export interface RoutingRule {
    model: string;
    when: string;
    thinking: ThinkingLevel;
    /** Absent when the stored rule leaves Fast to its own guidance. */
    fast?: FastMode;
}
export interface RoutingPolicy {
    rules: RoutingRule[];
    notes: string[];
}
export interface PolicyBlock {
    /** Offsets of the fenced block, fences included. */
    start: number;
    end: number;
}
export type PolicyParse = {
    ok: true;
    policy: RoutingPolicy;
    block: PolicyBlock;
} | {
    ok: false;
    error: string;
};
/** Reads the policy out of a skill body, or says exactly what to fix. */
export declare function parsePolicyBody(markdown: string): PolicyParse;
export type PolicyValidation = {
    policy: RoutingPolicy;
} | {
    error: string;
};
/**
 * Accepts exactly the stored shape. Unknown fields are refused rather than
 * dropped, so a hand edit is never silently rewritten.
 */
export declare function validatePolicy(value: unknown): PolicyValidation;
/** The exact block body: stable field order, two-space indent, one trailing newline. */
export declare function serializePolicy(policy: RoutingPolicy): string;
/** The whole skill body with only the policy block replaced. */
export declare function replacePolicyBody(markdown: string, block: PolicyBlock, policy: RoutingPolicy): string;
/** A new rule starts the way every stored rule is: fast off. */
export declare function emptyRule(): RoutingRule;
