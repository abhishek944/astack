/**
 * Usage-exhaustion fallback.
 *
 * A run can end because the model's plan usage is exhausted rather than because
 * the work is finished. Pi retries a failed request and pi-tasks continues while
 * active tasks remain, so either would ask the exhausted model again. This
 * extension acts on the failed turn itself, before that retry or any queued run:
 * it switches the session to the `default` rule of `model-routing-policy` so the
 * interrupted work resumes on that model, and when it cannot switch it aborts
 * the operation so nothing further reaches the exhausted model.
 *
 * The user authorizes this switch to override every responsibility-specific
 * routing rule for work already in progress. It never chooses models for new
 * subagents and never forces Fast mode.
 */
import type { ExtensionAPI, TurnEndEvent } from "@earendil-works/pi-coding-agent";
export interface UsageExhaustion {
    readonly provider: string;
    readonly model: string;
}
/**
 * The model whose confirmed plan usage is exhausted by this turn, if any.
 *
 * `turn_end` carries the finalized assistant message and runs before Pi decides
 * whether to retry the request or start queued work, which is what makes the
 * switch happen before any further request instead of after it.
 */
export declare function confirmedUsageExhaustion(message: TurnEndEvent["message"]): UsageExhaustion | null;
export declare function registerUsageFallback(pi: ExtensionAPI): void;
