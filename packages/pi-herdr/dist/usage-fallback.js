import { readDefaultRule } from "./routing-policy.js";
const CUSTOM_TYPE = "pi-usage-fallback";
/**
 * Wording Pi's provider layer treats as a terminal plan limit rather than a
 * retryable throttle (its `isTerminalRateLimitError`), plus the explicit
 * usage-limit codes and messages from the Codex and Anthropic providers.
 * Generic billing wording is deliberately absent: a declined card or a billing
 * configuration problem is not usage exhaustion, so it must never move the
 * session to another model. Anything else — authentication, context overflow, a
 * transient throttle, or a cancellation — is left to Pi's own retry and
 * reporting.
 */
const USAGE_LIMIT = /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|insufficient_quota|out of budget|usage_limit_reached|usage_not_included|subscription_sharing_\w*usage_limit_exceeded|enforced_spend_limit_reached|you have reached your api usage limits|you exceeded your current quota|hit your chatgpt usage limit/i;
const AMBIGUOUS_QUOTA = /quota exceeded/i;
const TRANSIENT = /rate.?limit|too many requests|overloaded|service.?unavailable|upstream.?connect|connection.?refused|timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed|socket hang up/i;
const AUTHENTICATION = /unauthori[sz]ed|forbidden|invalid api key|incorrect api key|authentication (?:failed|error)|token (?:expired|invalid)|no api key/i;
const CONTEXT_LIMIT = /context (?:window|length)|maximum context|too many tokens|context_length_exceeded|prompt is too long|input is too long/i;
/**
 * The model whose confirmed plan usage is exhausted by this turn, if any.
 *
 * `turn_end` carries the finalized assistant message and runs before Pi decides
 * whether to retry the request or start queued work, which is what makes the
 * switch happen before any further request instead of after it.
 */
export function confirmedUsageExhaustion(message) {
    if (message.role !== "assistant" || message.stopReason !== "error")
        return null;
    const evidence = message.errorMessage?.trim();
    if (!evidence)
        return null;
    if (AUTHENTICATION.test(evidence) || CONTEXT_LIMIT.test(evidence))
        return null;
    const confirmed = USAGE_LIMIT.test(evidence) || (AMBIGUOUS_QUOTA.test(evidence) && !TRANSIENT.test(evidence));
    if (!confirmed)
        return null;
    return { provider: message.provider, model: message.model };
}
function displayName(model) {
    return `${model.provider}/${model.id}`;
}
/**
 * Switch to the policy's default rule, or explain why the run must stop.
 * Nothing here continues the run; the caller owns that decision.
 */
async function resolveFallback(pi, ctx, exhaustion) {
    const source = `${exhaustion.provider}/${exhaustion.model}`;
    const policy = await readDefaultRule();
    if (!policy.ok) {
        return { resumed: false, message: `Model usage is exhausted for ${source}. Auto-continue stopped: ${policy.error}` };
    }
    const rule = policy.rule;
    if (rule.provider === exhaustion.provider && rule.modelId === exhaustion.model) {
        return {
            resumed: false,
            message: `Model usage is exhausted for ${source} and the policy's default rule names that same model. Auto-continue stopped; wait for the limit to reset.`,
        };
    }
    const target = ctx.modelRegistry.find(rule.provider, rule.modelId);
    if (!target) {
        return {
            resumed: false,
            message: `Model usage is exhausted for ${source}. Auto-continue stopped: ${rule.model} is not available in the model registry.`,
        };
    }
    let switched;
    try {
        switched = await pi.setModel(target);
        if (switched)
            pi.setThinkingLevel(rule.thinking);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { resumed: false, message: `Model usage is exhausted for ${source}. Auto-continue stopped: ${rule.model} could not be selected (${reason}).` };
    }
    if (!switched) {
        return {
            resumed: false,
            message: `Model usage is exhausted for ${source}. Auto-continue stopped: no credentials are configured for ${rule.provider}.`,
        };
    }
    return {
        resumed: true,
        message: `Model usage is exhausted for ${source}. Switched to ${displayName(target)} with thinking ${pi.getThinkingLevel()} and resumed the interrupted work.`,
    };
}
/** Text of messages waiting in the queue, so none is lost when the run stops. */
function pendingText(messages) {
    const texts = [];
    for (const message of messages) {
        if (message.role !== "user")
            continue;
        const text = typeof message.content === "string"
            ? message.content
            : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
        if (text.trim())
            texts.push(text);
    }
    return texts;
}
function visibleEntry(message) {
    return { type: "custom_message", customType: CUSTOM_TYPE, content: message, display: true };
}
export function registerUsageFallback(pi) {
    // The note for a switch that happened in this run's turn_end.
    let switchedNote = null;
    const reset = () => {
        switchedNote = null;
    };
    pi.on("session_start", reset);
    pi.on("session_shutdown", reset);
    // A user prompt is a fresh intent and must not inherit a pending note.
    // The note can span runs: a retry or a queued message starts a new run before
    // the settlement boundary that consumes it, and queueing one emits `input`.
    pi.on("agent_settled", reset);
    /**
     * Act on the confirmed error itself, before Pi retries the request and before
     * any queued message starts a run. A usable fallback is selected here, so the
     * retry and every queued run already use it; otherwise the operation is
     * aborted, which stops the session's retry and the settlement boundary (and
     * therefore pi-tasks auto-continue) altogether.
     */
    pi.on("turn_end", async (event, ctx) => {
        const exhaustion = confirmedUsageExhaustion(event.message);
        if (!exhaustion)
            return;
        let outcome;
        try {
            outcome = await resolveFallback(pi, ctx, exhaustion);
        }
        catch (error) {
            // Fail closed: an unexpected error must not leave the exhausted model in
            // the request path.
            const reason = error instanceof Error ? error.message : String(error);
            outcome = {
                resumed: false,
                message: `Model usage is exhausted for ${exhaustion.provider}/${exhaustion.model}. Auto-continue stopped: ${reason}`,
            };
        }
        ctx.ui.notify(outcome.message, "warning");
        if (!outcome.resumed) {
            // The session never reaches agent_before_settle after this, so record the
            // reason outside the transcript and let Pi's abort path return any queued
            // input to the editor instead of sending it to the exhausted model.
            const pending = pendingText(event.context.pendingMessages);
            pi.appendEntry(CUSTOM_TYPE, {
                message: outcome.message,
                stopped: true,
                ...(pending.length > 0 ? { pending } : {}),
            });
            ctx.abort();
            return;
        }
        switchedNote = outcome.message;
    });
    pi.on("agent_before_settle", (event) => {
        const note = switchedNote;
        if (!note)
            return;
        reset();
        const entries = [...event.entries, visibleEntry(note)];
        // A retried request already continued the work; otherwise resume it now on
        // the fallback model.
        return event.outcome === "error" ? { entries, continue: true } : { entries };
    });
}
