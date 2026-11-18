export declare const POLICY_SKILL = "model-routing-policy";
/** A responsibility rule describes prose; only the fallback uses this word. */
export declare const DEFAULT_RULE_WHEN = "default";
declare const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** The thinking levels `pi.setThinkingLevel()` accepts; Pi clamps them to the model. */
export type PolicyThinkingLevel = (typeof THINKING_LEVELS)[number];
export interface DefaultRule {
    /** `provider/model`, as stored in the policy. */
    readonly model: string;
    readonly provider: string;
    readonly modelId: string;
    readonly thinking: PolicyThinkingLevel;
}
export type DefaultRuleRead = {
    readonly ok: true;
    readonly path: string;
    readonly rule: DefaultRule;
} | {
    readonly ok: false;
    readonly error: string;
};
export declare function readDefaultRule(): Promise<DefaultRuleRead>;
export {};
