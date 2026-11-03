/** Shared contracts for the Slack transport. */

/** Slack thread identity: one native Pi session is bound per key. */
export type ThreadKey = {
	teamId: string;
	channelId: string;
	threadTs: string;
};

/** One authorized message routed into a thread. */
export type InboundMessage = {
	key: ThreadKey;
	/** Slack message timestamp, also the exact message identity for dedupe. */
	ts: string;
	userId: string;
	text: string;
};

/** One historical Slack message supplied to Pi as quoted thread context. */
export type ThreadHistoryMessage = {
	/** Slack message timestamp, preserved for ordering and attribution. */
	ts: string;
	/** Slack user ID when Slack supplies one (human or bot user). */
	userId: string | undefined;
	/** Slack bot ID for bot-authored messages. */
	botId: string | undefined;
	/** Display name supplied by Slack (bot profile or bot username); never looked up. */
	name: string | undefined;
	text: string;
	/** Names of attached files; contents are not downloaded. */
	fileNames: string[];
};

/** Every accessible message in a thread through one trigger timestamp, oldest first. */
export type ThreadHistory = {
	messages: ThreadHistoryMessage[];
};

/** A posted message this service can keep truthful and then clean up. */
export type PostedMessage = {
	/** Replace the text. Returns false when Slack refused the update. Never throws. */
	update(text: string): Promise<boolean>;
	/** Remove the message. Never throws. */
	remove(): Promise<void>;
};

/** A shown working indicator. Stopping it clears the visible state. */
export type WorkingIndicator = {
	/** Re-assert the working state after a reply auto-clears it. Never throws. */
	refresh(): Promise<void>;
	stop(): Promise<void>;
};

/** Outbound Slack side of the bridge. Implemented by the Bolt transport. */
export type SlackPort = {
	post(thread: ThreadKey, text: string): Promise<void>;
	/**
	 * Read the thread from its parent through `throughTs` inclusive, oldest first.
	 * Throws when Slack cannot return the history; callers must not prompt with a
	 * partial snapshot.
	 */
	fetchThread(thread: ThreadKey, throughTs: string): Promise<ThreadHistory>;
	/**
	 * Best-effort visible receipt for one accepted message. Returns false when
	 * Slack refused it, for example without the reactions:write scope. Never
	 * throws: the caller keeps delivering the request either way.
	 */
	acknowledge(thread: ThreadKey, messageTs: string): Promise<boolean>;
	/**
	 * Best-effort working indicator for one run. Returns undefined when this
	 * conversation cannot show one. Never throws.
	 */
	beginWorking(thread: ThreadKey): Promise<WorkingIndicator | undefined>;
	/**
	 * Post one short status message whose text can be updated or which can be
	 * removed later. Returns undefined when Slack refused the post. Never throws.
	 */
	postStatus(thread: ThreadKey, text: string): Promise<PostedMessage | undefined>;
};

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Structured operational log. Never carries message text or credentials. */
export type Logger = {
	event(name: string, fields?: LogFields): void;
};
