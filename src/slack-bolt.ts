import { App, LogLevel } from "@slack/bolt";
import type { Config } from "./config.js";
import type {
	InboundMessage,
	Logger,
	PostedMessage,
	SlackPort,
	ThreadHistoryMessage,
	ThreadKey,
	WorkingIndicator,
} from "./types.js";

/** Slack truncates the `text` field above 40,000 characters (docs.slack.dev). */
const SLACK_TEXT_LIMIT = 40_000;

/** Receipt reaction added to an accepted message. */
const SEEN_REACTION = "eyes";
const WORKING_STATUS = "Pi is working…";
/** Slack drops an assistant status after 2 minutes without a reply (docs.slack.dev). */
const WORKING_STATUS_TTL_MS = 120_000;
/** Refresh shortly before that expiry so a long run keeps the indicator visible. */
const WORKING_STATUS_REFRESH_MS = (WORKING_STATUS_TTL_MS * 3) / 4;

type SlackEventLike = {
	subtype?: string;
	channel?: string;
	channel_type?: string;
	user?: string;
	text?: string;
	ts?: string;
	thread_ts?: string;
	bot_id?: string;
	hidden?: boolean;
};

/** Structural subset of a conversations.replies message; Slack also sends `username`. */
type SlackReplyLike = {
	ts?: string;
	user?: string;
	bot_id?: string;
	text?: string;
	username?: string;
	bot_profile?: { name?: string };
	files?: { name?: string; title?: string }[];
};

export type SlackTransport = SlackPort & {
	start(): Promise<void>;
	stop(): Promise<void>;
};

/**
 * Official Bolt Socket Mode adapter. It owns authorization, channel filtering,
 * acknowledgements and the Slack API calls. It never decides session, model or
 * worker policy. The service creates exactly one instance at startup.
 */
export function createSlackTransport(options: {
	config: Config;
	logger: Logger;
	botToken: string;
	appToken: string;
	handleInbound: (message: InboundMessage) => void;
}): SlackTransport {
	const app = new App({
		token: options.botToken,
		appToken: options.appToken,
		socketMode: true,
		logLevel: LogLevel.WARN,
		// Validate the bot token explicitly in start() so a failure is reported by the
		// service entry instead of surfacing as an unhandled constructor promise.
		tokenVerificationEnabled: false,
	});
	const { config, logger } = options;
	/** A non-empty channel list restricts; an empty list means every channel the bot can access. */
	const restrictsChannels = config.enabledChannels.length > 0;

	const onEvent = (event: SlackEventLike, teamId: string | undefined, botUserId: string | undefined): void => {
		const channelId = event.channel;
		const userId = event.user;
		const ts = event.ts;
		if (channelId === undefined || userId === undefined || ts === undefined) return;
		if (teamId === undefined || teamId.trim() === "") return;
		if (restrictsChannels && !config.enabledChannels.includes(channelId)) return;
		if (!config.allowedUsers.includes(userId)) {
			logger.event("slack.unauthorized", { channelId, userId });
			return;
		}
		if (event.bot_id !== undefined) return;
		if (botUserId !== undefined && userId === botUserId) return;
		if (event.hidden === true) return;
		if (event.subtype !== undefined && event.subtype !== "thread_broadcast") return;
		const threadTs = event.thread_ts ?? ts;
		const key: ThreadKey = { teamId, channelId, threadTs };
		const text = stripBotMention(event.text ?? "", botUserId).trim();
		if (text === "") return;
		options.handleInbound({ key, ts, userId, text });
	};

	// Channels deliver app_mention and need a real bot user-ID mention. Slack never
	// sends app_mention for DMs or group DMs, so those are read from native message
	// events: a 1:1 DM is already addressed to the bot, while a group DM still needs
	// the mention. Untagged channel replies and group-DM messages stay in Slack and
	// are read back as quoted thread history on a later mention.
	app.event("app_mention", async ({ event, context, body }) => {
		onEvent(event as SlackEventLike, body.team_id, context.botUserId);
	});
	app.event("message", async ({ event, context, body }) => {
		const message = event as SlackEventLike;
		if (message.channel_type !== "im" && message.channel_type !== "mpim") return;
		// A 1:1 DM is already addressed to the bot, so every authorized message is a
		// request. Group DMs still need a real bot user-ID mention.
		if (message.channel_type === "mpim" && !mentionsBot(message.text ?? "", context.botUserId)) return;
		onEvent(message, body.team_id, context.botUserId);
	});
	app.error(async (error) => {
		logger.event("slack.error", { message: error.message });
	});

	return {
		async post(thread, text) {
			for (const chunk of splitForSlack(text)) {
				await app.client.chat.postMessage({ channel: thread.channelId, thread_ts: thread.threadTs, text: chunk });
			}
		},
		async acknowledge(thread, messageTs) {
			try {
				await app.client.reactions.add({
					channel: thread.channelId,
					timestamp: messageTs,
					name: SEEN_REACTION,
				});
				return true;
			} catch (error) {
				const code = slackErrorCode(error);
				// Repeating a reaction is a no-op, not a failure.
				if (code === "already_reacted") return true;
				logger.event("slack.reaction_failed", { channelId: thread.channelId, code });
				return false;
			}
		},
		async beginWorking(thread): Promise<WorkingIndicator | undefined> {
			const target = { channel_id: thread.channelId, thread_ts: thread.threadTs };
			const inFlight = new Set<Promise<void>>();
			const show = async (): Promise<void> => {
				// Installed SDK method; needs the bot's normal chat:write access, not a
				// separate assistant scope. An empty status clears the indicator.
				await app.client.assistant.threads.setStatus({ ...target, status: WORKING_STATUS });
			};
			const track = (run: Promise<void>): Promise<void> => {
				const tracked = run
					.catch((error: unknown) => {
						logger.event("slack.status_failed", { channelId: thread.channelId, code: slackErrorCode(error), refresh: true });
					})
					.finally(() => {
						inFlight.delete(tracked);
					});
				inFlight.add(tracked);
				return tracked;
			};
			try {
				await show();
			} catch (error) {
				logger.event("slack.status_failed", { channelId: thread.channelId, code: slackErrorCode(error) });
				return undefined;
			}
			let active = true;
			const timer = setInterval(() => {
				void track(show());
			}, WORKING_STATUS_REFRESH_MS);
			return {
				async refresh() {
					if (!active) return;
					await track(show());
				},
				async stop() {
					if (!active) return;
					active = false;
					clearInterval(timer);
					// Every queued refresh must land before the final clear, or one could
					// restore a working status after the run has ended.
					await Promise.all([...inFlight]);
					try {
						// A reply from Pi also clears it; this covers failures and stops.
						await app.client.assistant.threads.setStatus({ ...target, status: "" });
					} catch (error) {
						logger.event("slack.status_clear_failed", { channelId: thread.channelId, code: slackErrorCode(error) });
					}
				},
			};
		},
		async postStatus(thread, text): Promise<PostedMessage | undefined> {
			let ts: string | undefined;
			try {
				const response = await app.client.chat.postMessage({ channel: thread.channelId, thread_ts: thread.threadTs, text });
				ts = response.ts;
			} catch (error) {
				logger.event("slack.status_message_failed", { channelId: thread.channelId, code: slackErrorCode(error) });
				return undefined;
			}
			if (ts === undefined) return undefined;
			const messageTs = ts;
			return {
				async update(next) {
					try {
						await app.client.chat.update({ channel: thread.channelId, ts: messageTs, text: next });
						return true;
					} catch (error) {
						logger.event("slack.status_message_failed", { channelId: thread.channelId, code: slackErrorCode(error) });
						return false;
					}
				},
				async remove() {
					try {
						await app.client.chat.delete({ channel: thread.channelId, ts: messageTs });
					} catch (error) {
						logger.event("slack.status_message_failed", { channelId: thread.channelId, code: slackErrorCode(error) });
					}
				},
			};
		},
		async fetchThread(thread, throughTs) {
			const messages: ThreadHistoryMessage[] = [];
			const seen = new Set<string>();
			let cursor: string | undefined;
			do {
				const response = await app.client.conversations.replies({
					channel: thread.channelId,
					ts: thread.threadTs,
					latest: throughTs,
					inclusive: true,
					...(cursor === undefined ? {} : { cursor }),
				});
				for (const raw of response.messages ?? []) {
					const message: SlackReplyLike = raw;
					const ts = message.ts;
					if (ts === undefined || ts === "") continue;
					// The trigger is the current question, and newer messages are out of scope.
					if (ts === throughTs || compareTs(ts, throughTs) > 0) continue;
					if (seen.has(ts)) continue;
					seen.add(ts);
					const text = message.text ?? "";
					const fileNames: string[] = [];
					for (const file of message.files ?? []) {
						const name = file.name ?? file.title;
						if (name !== undefined && name !== "") fileNames.push(name);
					}
					if (text === "" && fileNames.length === 0) continue;
					messages.push({
						ts,
						userId: message.user,
						botId: message.bot_id,
						name: message.bot_profile?.name ?? message.username,
						text,
						fileNames,
					});
				}
				const next = response.response_metadata?.next_cursor;
				cursor = next === undefined || next === "" ? undefined : next;
			} while (cursor !== undefined);
			messages.sort((left, right) => compareTs(left.ts, right.ts));
			logger.event("slack.history_fetched", {
				channelId: thread.channelId,
				threadTs: thread.threadTs,
				messages: messages.length,
			});
			return { messages };
		},
		async start() {
			await app.client.auth.test();
			await app.start();
			logger.event("slack.started", {
				channels: restrictsChannels ? config.enabledChannels.length : "all-accessible",
				users: config.allowedUsers.length,
			});
		},
		async stop() {
			await app.stop();
			logger.event("slack.stopped");
		},
	};
}

/** Slack error code only, so cosmetic failures never log raw messages. */
function slackErrorCode(error: unknown): string {
	if (typeof error === "object" && error !== null) {
		const data = (error as { data?: { error?: unknown } }).data;
		if (typeof data?.error === "string" && data.error !== "") return data.error;
	}
	return "unknown";
}

function stripBotMention(text: string, botUserId: string | undefined): string {
	if (botUserId === undefined || botUserId === "") return text;
	return text.split(`<@${botUserId}>`).join(" ");
}

/** Slack mentions are `<@USER_ID>` tokens; plaintext "@name" is not a mention. */
function mentionsBot(text: string, botUserId: string | undefined): boolean {
	if (botUserId === undefined || botUserId === "") return false;
	return text.includes(`<@${botUserId}>`);
}

/** Slack timestamps are seconds.microseconds strings; numeric order matches Slack order. */
function compareTs(left: string, right: string): number {
	return Number(left) - Number(right);
}

/** Split only at Slack's documented limit, preferring newline boundaries. */
function splitForSlack(text: string): string[] {
	if (text.length <= SLACK_TEXT_LIMIT) return [text];
	const chunks: string[] = [];
	let rest = text;
	while (rest.length > SLACK_TEXT_LIMIT) {
		let cut = rest.lastIndexOf("\n", SLACK_TEXT_LIMIT);
		if (cut <= 0) cut = SLACK_TEXT_LIMIT;
		chunks.push(rest.slice(0, cut));
		rest = rest.slice(cut);
		if (rest.startsWith("\n")) rest = rest.slice(1);
	}
	if (rest !== "") chunks.push(rest);
	return chunks;
}
