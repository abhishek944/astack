import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Validated bridge configuration. User authorization fails closed when empty. */
export type Config = {
	/** Empty means every channel the bot can access; otherwise these channels only. */
	enabledChannels: string[];
	allowedUsers: string[];
	projectCwd: string;
};

export type ConfigPaths = {
	stateDir: string;
	configPath: string;
	statePath: string;
};

export class ConfigError extends Error {
	override name = "ConfigError";
}

export type SlackTokens = {
	botToken: string;
	appToken: string;
};

/**
 * Take ownership of the Slack tokens from the environment before any Pi session
 * exists, so in-process shell tools cannot inherit them. Missing tokens are
 * fatal; the service never starts half-configured.
 */
export function takeSlackTokens(env: NodeJS.ProcessEnv): SlackTokens {
	const botToken = env.SLACK_BOT_TOKEN?.trim() ?? "";
	const appToken = env.SLACK_APP_TOKEN?.trim() ?? "";
	delete env.SLACK_BOT_TOKEN;
	delete env.SLACK_APP_TOKEN;
	if (botToken === "" || appToken === "") {
		throw new ConfigError("SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set in the service environment");
	}
	return { botToken, appToken };
}

/**
 * State and config paths under the gateway's own user config directory. This is
 * deliberately independent of Pi's agent directory, which keeps its own models,
 * extensions and settings untouched by the gateway.
 */
export function resolvePaths(options: {
	env: NodeJS.ProcessEnv;
	stateDir?: string | undefined;
	configPath?: string | undefined;
}): ConfigPaths {
	const stateDir = resolve(options.stateDir ?? options.env.PI_SLACK_STATE_DIR ?? join(homedir(), ".config", "pi-slack"));
	const configPath = resolve(options.configPath ?? options.env.PI_SLACK_CONFIG ?? join(stateDir, "config.json"));
	return { stateDir, configPath, statePath: join(stateDir, "state.json") };
}

/**
 * Load and validate config. An absent or empty channel list means every channel
 * the bot can access; a non-empty list restricts to those IDs. Empty users, and
 * a relative or missing project directory, are fatal: the bridge must not fall
 * back to unrestricted user access.
 */
export function loadConfig(configPath: string): Config {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(configPath, "utf8"));
	} catch (error) {
		throw new ConfigError(`Cannot read config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ConfigError(`Config at ${configPath} must be a JSON object`);
	}
	const record = raw as Record<string, unknown>;
	const enabledChannels = stringList(record.enabledChannels, "enabledChannels", { optional: true });
	const allowedUsers = stringList(record.allowedUsers, "allowedUsers", { optional: false });
	const projectCwd = typeof record.projectCwd === "string" ? record.projectCwd.trim() : "";
	if (projectCwd === "" || !isAbsolute(projectCwd)) {
		throw new ConfigError("projectCwd must be an absolute path");
	}
	let projectStat;
	try {
		projectStat = statSync(projectCwd);
	} catch {
		throw new ConfigError(`projectCwd does not exist: ${projectCwd}`);
	}
	if (!projectStat.isDirectory()) {
		throw new ConfigError(`projectCwd is not a directory: ${projectCwd}`);
	}
	return { enabledChannels, allowedUsers, projectCwd };
}

function stringList(value: unknown, field: string, options: { optional: boolean }): string[] {
	if (value === undefined && options.optional) return [];
	if (!Array.isArray(value) || (!options.optional && value.length === 0)) {
		throw new ConfigError(
			options.optional ? `${field} must be an array of Slack IDs` : `${field} must be a non-empty array of Slack IDs`,
		);
	}
	const result: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.trim() === "") {
			throw new ConfigError(`${field} entries must be non-empty strings`);
		}
		result.push(entry.trim());
	}
	return result;
}
