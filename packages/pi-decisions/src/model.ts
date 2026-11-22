import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	realpath,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

export type Backend = "here.now" | "local";
export type QuestionMode = "single" | "multiple" | "review";
export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; path: string; alt: string; caption?: string }
	| { type: "video"; path: string; caption?: string }
	| { type: "mermaid"; code: string; caption?: string };
export interface ChoiceOption {
	id: string;
	label: string;
	content?: ContentBlock[];
}
export interface SubmitRequest {
	questionId: string;
	mode: QuestionMode;
	question: string;
	content?: ContentBlock[];
	options?: ChoiceOption[];
	recommended?: string;
	label?: string;
}
export interface Question extends SubmitRequest {
	content: ContentBlock[];
	options: ChoiceOption[];
}
export interface State {
	version: 2;
	sessionId: string;
	cwd: string;
	storageDir: string;
	questionId: string;
	revision: string;
	backend: Backend;
	question: Question;
	responsePath: string;
	statePath: string;
	bundleDir: string;
	files: { path: string; contentType: string }[];
	status: "prepared" | "publishing" | "ready" | "failed";
	url?: string;
	capability?: string;
	slug?: string;
	publication?: {
		versionId: string;
		finalizeUrl: string;
		uploads: { path: string; url: string; headers?: Record<string, string> }[];
	};
	error?: string;
	warnings?: string[];
}
export interface BrowserAnswer {
	question: string;
	revision: string;
	selected_ids: string[];
	comments: string;
}
export interface Answer {
	questionId: string;
	revision: string;
	mode: QuestionMode;
	selectedIds: string[];
	selectedLabels: string[];
	submissionType: "selection" | "comments-only";
	response: string;
	timestamp: string;
	sessionId: string;
	backend: Backend;
	recordId: string | null;
}

export function object(
	value: unknown,
	name = "value",
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${name} must be an object`);
	return value as Record<string, unknown>;
}
export function string(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${name} must be a nonempty string`);
	return value;
}
export function hash(bytes: string | Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}
export function inside(root: string, file: string): boolean {
	const relative = path.relative(root, file);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
}
export async function absoluteFile(input: string): Promise<string> {
	if (!path.isAbsolute(input))
		throw new Error("Media path must be a complete absolute filesystem path");
	const file = await realpath(input);
	if (!(await stat(file)).isFile())
		throw new Error("Media path must be a regular file");
	return file;
}
export type StorageLayout = "active" | "legacy";
const safeComponent = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Session-first so every project var/ entry stays attributable to a real session;
// `pi-decisions` occupies the segment a Work ID uses and cannot collide with W<number>.
// `legacy` is read-only history for the migration command and is never created here.
const layouts: Record<StorageLayout, (sessionId: string) => string[]> = {
	active: (sessionId) => ["var", sessionId, "pi-decisions"],
	legacy: (sessionId) => [".pi", "decisions", sessionId],
};
export async function sessionStorage(
	cwd: string,
	sessionId: string,
	create = false,
	layout: StorageLayout = "active",
) {
	if (!safeComponent.test(sessionId))
		throw new Error("Missing or unsafe session identity");
	const root = await realpath(cwd);
	let storageDir = root;
	for (const segment of layouts[layout](sessionId)) {
		storageDir = path.join(storageDir, segment);
		if (create) {
			try {
				await mkdir(storageDir, { mode: 0o700 });
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			}
		}
		if (
			(await realpath(storageDir)) !== storageDir ||
			!(await stat(storageDir)).isDirectory()
		)
			throw new Error(
				"Question storage must be a real directory inside the project",
			);
	}
	return { cwd: root, storageDir, layout };
}
export function questionPaths(storageDir: string, id: string) {
	const questionDir = path.join(storageDir, questionId(id));
	return {
		questionDir,
		statePath: path.join(questionDir, "state.json"),
		responsePath: path.join(questionDir, "response.json"),
		bundleDir: path.join(questionDir, "public"),
	};
}
export type PendingPath =
	| { kind: "active"; questionId: string; statePath: string }
	| { kind: "legacy"; questionId: string; statePath: string; relocated: string }
	| { kind: "unattributed" };
function canonicalQuestionPath(
	root: string,
	sessionId: string,
	layout: StorageLayout,
	id: string,
): string {
	return path.join(root, ...layouts[layout](sessionId), id, "state.json");
}
function savedQuestionId(
	root: string,
	sessionId: string,
	saved: string,
	layout: StorageLayout,
): string | undefined {
	if (!path.isAbsolute(saved) || path.normalize(saved) !== saved) return;
	if (path.basename(saved) !== "state.json") return;
	const id = path.basename(path.dirname(saved));
	if (!safeComponent.test(id)) return;
	return canonicalQuestionPath(root, sessionId, layout, id) === saved
		? id
		: undefined;
}
// Session entries written before the var/ layout recorded absolute `.pi/decisions`
// pathnames. A saved reference belongs to this project only when it is exactly the
// canonical active or legacy state pathname under the current real project root for the
// current session; anything else is reported, never translated or loaded. Legacy state is
// never read, and delivery keeps using the active layout exclusively.
export function classifyPendingPath(
	root: string,
	sessionId: string,
	saved: string,
): PendingPath {
	const active = savedQuestionId(root, sessionId, saved, "active");
	if (active) return { kind: "active", questionId: active, statePath: saved };
	const legacy = savedQuestionId(root, sessionId, saved, "legacy");
	if (!legacy) return { kind: "unattributed" };
	return {
		kind: "legacy",
		questionId: legacy,
		statePath: saved,
		relocated: canonicalQuestionPath(root, sessionId, "active", legacy),
	};
}
function unsupportedFormat(): Error {
	return new Error(
		"Unsupported saved question format. Submit with a new questionId; existing files were not changed.",
	);
}
// The single ownership rule: a saved state must describe exactly the canonical paths
// derived from its own project, session and question identity.
function assertOwnership(
	state: State,
	canonical: string,
	storageDir: string,
	sessionId: string,
): void {
	const paths = questionPaths(storageDir, state.questionId);
	if (
		state.statePath !== canonical ||
		paths.statePath !== canonical ||
		state.storageDir !== storageDir ||
		state.responsePath !== paths.responsePath ||
		state.bundleDir !== paths.bundleDir ||
		!["local", "here.now"].includes(state.backend) ||
		!["single", "multiple", "review"].includes(state.question.mode) ||
		state.question.questionId !== state.questionId ||
		state.sessionId !== sessionId
	)
		throw new Error("State paths/backend are not owned by this question");
}
export function questionId(value: unknown): string {
	const id = string(value, "questionId");
	if (!safeComponent.test(id))
		throw new Error("questionId must be a safe filename component");
	return id;
}
export async function json<T>(file: string): Promise<T> {
	return JSON.parse(await readFile(file, "utf8")) as T;
}
export async function optionalJson<T>(file: string): Promise<T | undefined> {
	try {
		return await json<T>(file);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
		throw e;
	}
}
export async function save(file: string, value: unknown): Promise<void> {
	const temp = `${file}.${randomUUID()}.tmp`;
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await rename(temp, file);
}
export async function privateDirectory(dir: string) {
	await mkdir(dir, { recursive: true, mode: 0o700 });
}
export async function loadState(
	file: string,
	expectedSession?: string,
): Promise<State> {
	const canonical = await realpath(file);
	const state = await json<State>(canonical);
	if (state.version !== 2) throw unsupportedFormat();
	const sessionId = expectedSession ?? state.sessionId;
	const storage = await sessionStorage(state.cwd, sessionId);
	assertOwnership(state, canonical, storage.storageDir, sessionId);
	return state;
}
async function requireProject(cwd: string): Promise<void> {
	const info = await stat(cwd).catch((e: NodeJS.ErrnoException) => {
		if (e.code === "ENOENT") return null;
		throw e;
	});
	if (!info?.isDirectory())
		throw new Error("Saved question project directory is missing");
}
// Migration-only reader: resolves whichever layout currently holds the file. Delivery
// paths keep using the strict active-layout loadState above.
export async function inspectState(
	file: string,
): Promise<{ state: State; layout: StorageLayout; canonical: string }> {
	const canonical = await realpath(file);
	const state = await json<State>(canonical);
	if (state.version !== 2) throw unsupportedFormat();
	await requireProject(state.cwd);
	let unowned: Error | undefined;
	for (const layout of ["active", "legacy"] as const) {
		let storage: Awaited<ReturnType<typeof sessionStorage>>;
		try {
			storage = await sessionStorage(state.cwd, state.sessionId, false, layout);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw e;
		}
		try {
			assertOwnership(state, canonical, storage.storageDir, state.sessionId);
		} catch (e) {
			unowned = e as Error;
			continue;
		}
		return { state, layout, canonical };
	}
	throw unowned ?? new Error("Invalid state identity");
}
export function normalize(
	state: State,
	input: unknown,
	recordId: string | null = null,
): Answer {
	const raw = object(input, "answer");
	if (raw.question !== state.questionId || raw.revision !== state.revision)
		throw new Error("Answer identity/revision mismatch");
	if (
		!Array.isArray(raw.selected_ids) ||
		raw.selected_ids.some((id) => typeof id !== "string") ||
		new Set(raw.selected_ids).size !== raw.selected_ids.length
	)
		throw new Error("Invalid selected ids");
	const ids = raw.selected_ids as string[];
	if (
		ids.some((id) => !state.question.options.some((o) => o.id === id)) ||
		(state.question.mode === "single" && ids.length > 1) ||
		(state.question.mode === "review" && ids.length > 0)
	)
		throw new Error("Unknown or incompatible choice");
	if (typeof raw.comments !== "string" || (!ids.length && !raw.comments.trim()))
		throw new Error("Choose an option or provide comments");
	const selected = state.question.options.filter((o) => ids.includes(o.id));
	return {
		questionId: state.questionId,
		revision: state.revision,
		mode: state.question.mode,
		selectedIds: selected.map((o) => o.id),
		selectedLabels: selected.map((o) => o.label),
		submissionType: selected.length ? "selection" : "comments-only",
		response: raw.comments,
		timestamp: new Date().toISOString(),
		sessionId: state.sessionId,
		backend: state.backend,
		recordId,
	};
}
