import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile, } from "node:fs/promises";
import path from "node:path";
export function object(value, name = "value") {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${name} must be an object`);
    return value;
}
export function string(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name} must be a nonempty string`);
    return value;
}
export function hash(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
export function inside(root, file) {
    const relative = path.relative(root, file);
    return (relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative)));
}
export async function absoluteFile(input) {
    if (!path.isAbsolute(input))
        throw new Error("Media path must be a complete absolute filesystem path");
    const file = await realpath(input);
    if (!(await stat(file)).isFile())
        throw new Error("Media path must be a regular file");
    return file;
}
export async function sessionStorage(cwd, sessionId, create = false) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sessionId))
        throw new Error("Missing or unsafe session identity");
    const root = await realpath(cwd);
    let storageDir = root;
    for (const segment of [".pi", "decisions", sessionId]) {
        storageDir = path.join(storageDir, segment);
        if (create) {
            try {
                await mkdir(storageDir, { mode: 0o700 });
            }
            catch (e) {
                if (e.code !== "EEXIST")
                    throw e;
            }
        }
        if ((await realpath(storageDir)) !== storageDir ||
            !(await stat(storageDir)).isDirectory())
            throw new Error("Question storage must be a real directory inside the project");
    }
    return { cwd: root, storageDir };
}
export function questionId(value) {
    const id = string(value, "questionId");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))
        throw new Error("questionId must be a safe filename component");
    return id;
}
export async function json(file) {
    return JSON.parse(await readFile(file, "utf8"));
}
export async function optionalJson(file) {
    try {
        return await json(file);
    }
    catch (e) {
        if (e.code === "ENOENT")
            return;
        throw e;
    }
}
export async function save(file, value) {
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
}
export async function privateDirectory(dir) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
}
export async function loadState(file, expectedSession) {
    const canonical = await realpath(file);
    const state = await json(canonical);
    if (state.version !== 2)
        throw new Error("Unsupported saved question format. Submit with a new questionId; existing files were not changed.");
    if (state.statePath !== canonical)
        throw new Error("Invalid state identity");
    const storage = await sessionStorage(state.cwd, expectedSession ?? state.sessionId);
    const questionDir = path.join(storage.storageDir, questionId(state.questionId));
    if (path.join(questionDir, "state.json") !== canonical ||
        state.storageDir !== storage.storageDir ||
        state.responsePath !== path.join(questionDir, "response.json") ||
        state.bundleDir !== path.join(questionDir, "public") ||
        !["local", "here.now"].includes(state.backend) ||
        !["single", "multiple", "review"].includes(state.question.mode) ||
        state.question.questionId !== state.questionId ||
        state.sessionId !== (expectedSession ?? state.sessionId))
        throw new Error("State paths/backend are not owned by this question");
    return state;
}
export function normalize(state, input, recordId = null) {
    const raw = object(input, "answer");
    if (raw.question !== state.questionId || raw.revision !== state.revision)
        throw new Error("Answer identity/revision mismatch");
    if (!Array.isArray(raw.selected_ids) ||
        raw.selected_ids.some((id) => typeof id !== "string") ||
        new Set(raw.selected_ids).size !== raw.selected_ids.length)
        throw new Error("Invalid selected ids");
    const ids = raw.selected_ids;
    if (ids.some((id) => !state.question.options.some((o) => o.id === id)) ||
        (state.question.mode === "single" && ids.length > 1) ||
        (state.question.mode === "review" && ids.length > 0))
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
