import type { Logger } from "./types.js";

/** One JSON record per line on stderr. Slack never receives these records. */
export function createStderrLogger(): Logger {
	return {
		event(name, fields) {
			const record = { ts: new Date().toISOString(), event: name, ...fields };
			process.stderr.write(`${JSON.stringify(record)}\n`);
		},
	};
}
