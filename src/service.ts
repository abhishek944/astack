#!/usr/bin/env node
import { initTheme } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolvePaths, takeSlackTokens } from "./config.js";
import { createStderrLogger } from "./log.js";
import { createSlackTransport } from "./slack-bolt.js";
import { StateStore } from "./state.js";
import { ThreadManager } from "./threads.js";

const logger = createStderrLogger();

/** Wrap startup so every failure is one sanitized stderr record and exit 1. */
async function main(): Promise<void> {
	try {
		await run();
	} catch (error) {
		logger.event("service.start_failed", { message: redact(error) });
		process.exit(1);
	}
}

/**
 * Background gateway entry. The OS service manager owns startup, restart and
 * logging; this process owns exactly one Socket Mode connection and every
 * in-process thread session, then releases both on SIGINT/SIGTERM.
 */
async function run(): Promise<void> {
	// Resolve and validate everything before the connection exists so a bad
	// config or missing token fails fast.
	const paths = resolvePaths({ env: process.env });
	const config = loadConfig(paths.configPath);
	const tokens = takeSlackTokens(process.env);
	const state = await StateStore.load(paths.statePath);
	// The public SDK theme facility replaces the TUI's theme. Thread sessions
	// never render, but extension helpers that read the global theme still work.
	initTheme();

	let manager: ThreadManager;
	const transport = createSlackTransport({
		config,
		logger,
		botToken: tokens.botToken,
		appToken: tokens.appToken,
		handleInbound: (message) => manager.handleInbound(message),
	});
	manager = new ThreadManager({ config, state, slack: transport, logger });

	let started = false;
	let stopping: Promise<void> | undefined;
	const starting = transport.start().then(() => {
		started = true;
	});

	const stop = (signal?: string): Promise<void> => {
		stopping ??= (async () => {
			if (signal !== undefined) logger.event("service.stopping", { signal });
			// A signal can arrive while the connection is still starting.
			await starting.catch(() => {});
			try {
				// Marks intake closed first, aborts active runs, clears visible working
				// status while Slack is still reachable, disposes every thread runtime
				// and flushes state.
				await manager.shutdown();
			} catch (error) {
				logger.event("threads.shutdown_failed", { message: redact(error) });
			}
			if (started) {
				started = false;
				try {
					await transport.stop();
				} catch (error) {
					logger.event("slack.stop_failed", { message: redact(error) });
				}
			}
		})();
		return stopping;
	};

	process.once("SIGINT", () => {
		void stop("SIGINT").then(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void stop("SIGTERM").then(() => process.exit(0));
	});

	try {
		await starting;
	} catch (error) {
		logger.event("service.start_failed", { message: redact(error) });
		await stop();
		process.exit(1);
	}
	logger.event("service.ready", {
		config: paths.configPath,
		project: config.projectCwd,
		channels: config.enabledChannels.length === 0 ? "all-accessible" : config.enabledChannels.length,
		users: config.allowedUsers.length,
	});
}

/** Never let a Slack token reach stderr, even inside a provider error. */
function redact(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\b(xox[a-z]|xapp)-[A-Za-z0-9-]+/g, "$1-[redacted]");
}

await main();
