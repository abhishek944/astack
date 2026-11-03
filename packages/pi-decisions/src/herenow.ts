import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { object, type State, save, string } from "./model.js";

const API = "https://here.now";
export class ApiError extends Error {
	constructor(
		public status: number,
		public retryAfterMs?: number,
		public code?: string,
		public providerMessage?: string,
	) {
		super(
			`here.now request failed (HTTP ${status}${code ? `: ${code}` : ""})${providerMessage ? `: ${providerMessage}` : ""}`,
		);
	}
}
function safeDiagnostic(value: unknown, token: string): string | undefined {
	if (typeof value !== "string") return;
	return value
		.replaceAll(token, "[redacted]")
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/\bhnk_[A-Za-z0-9_-]+/g, "[redacted]")
		.replace(/[\r\n\t]/g, " ");
}
function retryAfter(value: string | null): number | undefined {
	if (!value) return;
	const number = Number(value);
	if (Number.isFinite(number)) return Math.max(0, number * 1000);
	const time = Date.parse(value);
	return Number.isFinite(time) ? Math.max(0, time - Date.now()) : undefined;
}
async function key(): Promise<string> {
	const env = process.env.HERENOW_API_KEY?.trim();
	if (env) return env;
	try {
		return string(
			(
				await readFile(
					path.join(os.homedir(), ".herenow", "credentials"),
					"utf8",
				)
			).trim(),
			"here.now credentials",
		);
	} catch {
		throw new Error(
			"here.now requires HERENOW_API_KEY or ~/.herenow/credentials. No local fallback was attempted.",
		);
	}
}
async function api(
	url: string,
	token: string,
	init: RequestInit = {},
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const target = new URL(url, API);
	if (target.origin !== API)
		throw new Error("Refusing to send here.now credentials to another origin");
	const response = await fetch(target, {
		...init,
		redirect: "error",
		signal,
		headers: {
			...init.headers,
			Authorization: `Bearer ${token}`,
			"X-HereNow-Client": "pi/pi-decisions",
		},
	});
	if (!response.ok) {
		let diagnostic: Record<string, unknown> = {};
		try {
			diagnostic = object(await response.json(), "provider error");
		} catch {
			/* Non-JSON errors still retain their HTTP status. */
		}
		const rawCode =
			typeof diagnostic.code === "string" &&
			/^[a-z][a-z0-9_]*$/.test(diagnostic.code)
				? diagnostic.code
				: undefined;
		const bodyRetry =
			typeof diagnostic.retry_after === "number" &&
			Number.isFinite(diagnostic.retry_after) &&
			diagnostic.retry_after >= 0
				? String(diagnostic.retry_after)
				: null;
		throw new ApiError(
			response.status,
			retryAfter(response.headers.get("retry-after") ?? bodyRetry),
			safeDiagnostic(rawCode, token),
			safeDiagnostic(diagnostic.message, token),
		);
	}
	return object(await response.json(), "here.now response");
}
export async function publish(
	state: State,
	signal?: AbortSignal,
): Promise<void> {
	const token = await key();
	const files: { path: string; size: number; contentType: string }[] = [];
	for (const file of state.files) {
		const bytes = await readFile(path.join(state.bundleDir, file.path));
		files.push({
			path: file.path,
			size: bytes.length,
			contentType: file.contentType,
		});
	}
	// Record the uncertain side effect before POST; failed creates must never be blindly replayed.
	state.status = "publishing";
	await save(state.statePath, state);
	const created = await api(
		"/api/v1/publish",
		token,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ files }),
		},
		signal,
	);
	state.slug = string(created.slug, "site slug");
	const upload = object(created.upload, "upload");
	const targets = upload.uploads;
	if (!Array.isArray(targets))
		throw new Error("Invalid here.now upload targets");
	state.publication = {
		versionId: string(upload.versionId, "versionId"),
		finalizeUrl: string(upload.finalizeUrl, "finalizeUrl"),
		uploads: targets.map((item) => {
			const target = object(item, "upload target"),
				name = string(target.path, "upload path");
			if (!files.some((f) => f.path === name))
				throw new Error("Upload target is outside the explicit public bundle");
			const headers = object(target.headers, "upload headers");
			if (Object.values(headers).some((v) => typeof v !== "string"))
				throw new Error("Invalid upload headers");
			return {
				path: name,
				url: string(target.url, "upload URL"),
				headers: headers as Record<string, string>,
			};
		}),
	};
	await save(state.statePath, state);
	for (const target of state.publication.uploads) {
		const url = new URL(target.url);
		if (
			url.protocol !== "https:" ||
			!url.hostname.endsWith(".r2.cloudflarestorage.com")
		)
			throw new Error("Unexpected here.now storage upload origin");
		const response = await fetch(url, {
			method: "PUT",
			headers: target.headers,
			body: await readFile(path.join(state.bundleDir, target.path)),
			redirect: "error",
			signal,
		});
		if (!response.ok)
			throw new Error(`here.now asset upload failed (HTTP ${response.status})`);
	}
	const finalized = await api(
		state.publication.finalizeUrl,
		token,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ versionId: state.publication.versionId }),
		},
		signal,
	);
	const status = object(finalized.publishStatus, "publishStatus");
	if (
		finalized.success !== true ||
		status.state !== "live" ||
		!["personal", "workspace"].includes(String(status.ownership))
	)
		throw new Error("here.now did not confirm account-owned live publication");
	state.url = string(finalized.primaryUrl ?? finalized.siteUrl, "site URL");
	if (new URL(state.url).protocol !== "https:")
		throw new Error("Invalid published URL");
	state.status = "ready";
	state.warnings = Array.isArray(finalized.warnings)
		? finalized.warnings.map(String)
		: [];
	await save(state.statePath, state);
	if (state.warnings.length)
		throw new Error(
			"Site published with provider warnings; inspect its here.now dashboard before collecting answers. State retains the live URL.",
		);
}
export async function* records(
	state: State,
	signal?: AbortSignal,
): AsyncGenerator<{ id: string; data: unknown }> {
	if (!state.slug)
		throw new Error("No account-owned Site is pinned to this question");
	const token = await key();
	let cursor: string | undefined;
	do {
		const url = new URL(
			`/api/v1/publishes/${encodeURIComponent(state.slug)}/data/answers`,
			API,
		);
		if (cursor) url.searchParams.set("cursor", cursor);
		const result = await api(url.href, token, {}, signal);
		if (!Array.isArray(result.records))
			throw new Error("Invalid Site Data records response");
		for (const item of result.records) {
			const r = object(item, "record");
			let data: Record<string, unknown>;
			let selectedIds: unknown;
			try {
				data = object(r.data, "record data");
				if (typeof data.selected_ids !== "string") continue;
				selectedIds = JSON.parse(data.selected_ids);
			} catch {
				continue;
			}
			if (
				!Array.isArray(selectedIds) ||
				selectedIds.some((id) => typeof id !== "string")
			)
				continue;
			// Provider wire encoding stays here; the shared trust boundary still validates array IDs/revision.
			yield {
				id: string(r.id, "record id"),
				data: { ...data, selected_ids: selectedIds },
			};
		}
		if (result.nextCursor !== null && typeof result.nextCursor !== "string")
			throw new Error("Invalid Site Data pagination cursor");
		cursor =
			typeof result.nextCursor === "string" ? result.nextCursor : undefined;
	} while (cursor);
}
