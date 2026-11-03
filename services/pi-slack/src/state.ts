import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ThreadKey } from "./types.js";

/** One Slack thread bound to one native Pi session. */
export type Binding = {
	teamId: string;
	channelId: string;
	threadTs: string;
	/** Working directory of the bound native session. */
	cwd: string;
	/** Absolute native session file; materializes once the session has content. */
	sessionFile: string;
	sessionId: string;
	/** Exact Slack message identities already accepted for this thread. */
	processedTs: string[];
};

type StateFile = {
	version: 2;
	bindings: Record<string, Binding>;
};

export class StateError extends Error {
	override name = "StateError";
}

export function bindingKey(key: ThreadKey): string {
	return `${key.teamId}:${key.channelId}:${key.threadTs}`;
}

/**
 * The bridge's only durable state: thread bindings and their accepted message
 * identities. Writes are atomic and serialized. A corrupt file is fatal rather
 * than silently reset, because a reset would orphan existing sessions and
 * re-deliver or lose messages.
 */
export class StateStore {
	readonly #file: string;
	readonly #bindings = new Map<string, Binding>();
	#writeChain: Promise<void> = Promise.resolve();
	#lastError: Error | undefined;
	#dirty = false;

	private constructor(file: string, bindings: Map<string, Binding>) {
		this.#file = file;
		this.#bindings = bindings;
	}

	static async load(file: string): Promise<StateStore> {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return new StateStore(file, new Map());
			throw new StateError(`Cannot read state at ${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw new StateError(`State at ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new StateError(`State at ${file} must be a JSON object`);
		}
		const record = parsed as Record<string, unknown>;
		if (record.version !== 2) {
			throw new StateError(`State at ${file} has unsupported version ${String(record.version)}; this package writes version 2`);
		}
		if (typeof record.bindings !== "object" || record.bindings === null || Array.isArray(record.bindings)) {
			throw new StateError(`State at ${file} has invalid bindings`);
		}
		const bindings = new Map<string, Binding>();
		for (const [key, value] of Object.entries(record.bindings as Record<string, unknown>)) {
			bindings.set(key, parseBinding(value, file));
		}
		return new StateStore(file, bindings);
	}

	get(key: ThreadKey): Binding | undefined {
		return this.#bindings.get(bindingKey(key));
	}

	list(): Binding[] {
		return [...this.#bindings.values()];
	}

	get size(): number {
		return this.#bindings.size;
	}

	/** Store a binding and schedule an atomic write. */
	set(binding: Binding): void {
		this.#bindings.set(bindingKey(binding), binding);
		this.#scheduleWrite();
	}

	async flush(): Promise<void> {
		await this.#writeChain;
		if (this.#lastError !== undefined) throw this.#lastError;
	}

	#scheduleWrite(): void {
		this.#dirty = true;
		this.#writeChain = this.#writeChain.then(() =>
			this.#write().catch((error: unknown) => {
				this.#lastError = error instanceof Error ? error : new Error(String(error));
			}),
		);
	}

	async #write(): Promise<void> {
		if (!this.#dirty) return;
		this.#dirty = false;
		try {
			const data: StateFile = { version: 2, bindings: Object.fromEntries(this.#bindings) };
			const directory = dirname(this.#file);
			mkdirSync(directory, { recursive: true, mode: 0o700 });
			const temporary = `${this.#file}.tmp`;
			writeFileSync(temporary, `${JSON.stringify(data, null, "\t")}\n`, { mode: 0o600 });
			renameSync(temporary, this.#file);
			this.#lastError = undefined;
		} catch (error) {
			this.#dirty = true;
			throw error;
		}
	}
}

function parseBinding(value: unknown, file: string): Binding {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new StateError(`State at ${file} has an invalid binding`);
	}
	const record = value as Record<string, unknown>;
	const result = {} as Binding;
	for (const field of ["teamId", "channelId", "threadTs", "cwd", "sessionFile", "sessionId"] as const) {
		const entry = record[field];
		if (typeof entry !== "string" || entry === "") {
			throw new StateError(`State at ${file} binding is missing ${field}`);
		}
		result[field] = entry;
	}
	const processed = record.processedTs;
	if (!Array.isArray(processed) || processed.some((entry) => typeof entry !== "string" || entry === "")) {
		throw new StateError(`State at ${file} binding has invalid processedTs`);
	}
	result.processedTs = [...processed];
	return result;
}
