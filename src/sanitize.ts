/** Fixed, sanitized notices. Raw provider or RPC diagnostics never reach Slack. */

export const ABORTED_NOTICE = "The Pi run was stopped.";

/**
 * Fallback receipt when Slack refuses the reaction (for example without the
 * reactions:write scope). It states only that the message was accepted.
 */
export const RECEIVED_NOTICE = "👀 Received. Pi will reply in this thread.";

/**
 * Visible working state used when Slack refuses the native assistant status. It
 * either replaces the receipt text or is one temporary notice removed on stop.
 */
export const WORKING_NOTICE = "🛠️ Pi is working…";

export function failureNotice(message: string | undefined): string {
	const text = message ?? "";
	if (/auth|credential|api key|unauthorized|forbidden|\b401\b|\b403\b|login/i.test(text)) {
		return "Pi could not use the configured model credentials. Check the Pi host configuration.";
	}
	if (/no model|model not found|no models? selected|no models available/i.test(text)) {
		return "Pi has no usable model selected. Check the Pi host configuration.";
	}
	if (/rate|quota|overload|too many|\b429\b/i.test(text)) {
		return "The model provider is rate-limited or unavailable right now. Try again later.";
	}
	if (/context|token limit|too long|overflow/i.test(text)) {
		return "The run exceeded the model context limit.";
	}
	if (/abort|cancel|stopped/i.test(text)) {
		return ABORTED_NOTICE;
	}
	return "Pi did not complete the run. Check the Pi host session for details.";
}

export function promptRejectionNotice(message: string | undefined): string {
	return `Pi rejected the message before starting a run. ${failureNotice(message)}`;
}

/**
 * Fixed notice for a failed thread-history read. The message is not sent to Pi
 * with partial context. Slack error codes are classified, never echoed.
 */
export function historyFailureNotice(message: string | undefined): string {
	const text = message ?? "";
	if (/missing_scope|not_authed|invalid_auth|token_revoked|account_inactive|not_allowed_token_type/i.test(text)) {
		return "Slack did not allow the service to read this thread's history, so the message was not sent to Pi. Check the app's channel history scopes and channel membership.";
	}
	if (/channel_not_found|not_in_channel|thread_not_found|is_archived/i.test(text)) {
		return "Slack could not return this thread's history, so the message was not sent to Pi. Check that the app can still access this channel and thread.";
	}
	if (/ratelimited|rate_limited|too_many|\b429\b/i.test(text)) {
		return "Slack rate-limited the thread history request, so the message was not sent to Pi. Send the message again later.";
	}
	return "The service could not read this thread's history, so the message was not sent to Pi. Send the message again later.";
}
