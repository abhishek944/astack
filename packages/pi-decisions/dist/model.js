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
const safeComponent = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Session-first so every project var/ entry stays attributable to a real session;
// `pi-decisions` occupies the segment a Work ID uses and cannot collide with W<number>.
// `legacy` is read-only history for the migration command and is never created here.
const layouts = {
    active: (sessionId) => ["var", sessionId, "pi-decisions"],
    legacy: (sessionId) => [".pi", "decisions", sessionId],
};
export async function sessionStorage(cwd, sessionId, create = false, layout = "active") {
    if (!safeComponent.test(sessionId))
        throw new Error("Missing or unsafe session identity");
    const root = await realpath(cwd);
    let storageDir = root;
    for (const segment of layouts[layout](sessionId)) {
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
    return { cwd: root, storageDir, layout };
}
export function questionPaths(storageDir, id) {
    const questionDir = path.join(storageDir, questionId(id));
    return {
        questionDir,
        statePath: path.join(questionDir, "state.json"),
        responsePath: path.join(questionDir, "response.json"),
        bundleDir: path.join(questionDir, "public"),
    };
}
function canonicalQuestionPath(root, sessionId, layout, id) {
    return path.join(root, ...layouts[layout](sessionId), id, "state.json");
}
function savedQuestionId(root, sessionId, saved, layout) {
    if (!path.isAbsolute(saved) || path.normalize(saved) !== saved)
        return;
    if (path.basename(saved) !== "state.json")
        return;
    const id = path.basename(path.dirname(saved));
    if (!safeComponent.test(id))
        return;
    return canonicalQuestionPath(root, sessionId, layout, id) === saved
        ? id
        : undefined;
}
// Session entries written before the var/ layout recorded absolute `.pi/decisions`
// pathnames. A saved reference belongs to this project only when it is exactly the
// canonical active or legacy state pathname under the current real project root for the
// current session; anything else is reported, never translated or loaded. Legacy state is
// never read, and delivery keeps using the active layout exclusively.
export function classifyPendingPath(root, sessionId, saved) {
    const active = savedQuestionId(root, sessionId, saved, "active");
    if (active)
        return { kind: "active", questionId: active, statePath: saved };
    const legacy = savedQuestionId(root, sessionId, saved, "legacy");
    if (!legacy)
        return { kind: "unattributed" };
    return {
        kind: "legacy",
        questionId: legacy,
        statePath: saved,
        relocated: canonicalQuestionPath(root, sessionId, "active", legacy),
    };
}
function unsupportedFormat() {
    return new Error("Unsupported saved question format. Submit with a new questionId; existing files were not changed.");
}
// The single ownership rule: a saved state must describe exactly the canonical paths
// derived from its own project, session and question identity.
function assertOwnership(state, canonical, storageDir, sessionId) {
    const paths = questionPaths(storageDir, state.questionId);
    if (state.statePath !== canonical ||
        paths.statePath !== canonical ||
        state.storageDir !== storageDir ||
        state.responsePath !== paths.responsePath ||
        state.bundleDir !== paths.bundleDir ||
        !["local", "here.now"].includes(state.backend) ||
        !["single", "multiple", "review"].includes(state.question.mode) ||
        state.question.questionId !== state.questionId ||
        state.sessionId !== sessionId)
        throw new Error("State paths/backend are not owned by this question");
}
export function questionId(value) {
    const id = string(value, "questionId");
    if (!safeComponent.test(id))
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
        throw unsupportedFormat();
    const sessionId = expectedSession ?? state.sessionId;
    const storage = await sessionStorage(state.cwd, sessionId);
    assertOwnership(state, canonical, storage.storageDir, sessionId);
    return state;
}
async function requireProject(cwd) {
    const info = await stat(cwd).catch((e) => {
        if (e.code === "ENOENT")
            return null;
        throw e;
    });
    if (!info?.isDirectory())
        throw new Error("Saved question project directory is missing");
}
// Migration-only reader: resolves whichever layout currently holds the file. Delivery
// paths keep using the strict active-layout loadState above.
export async function inspectState(file) {
    const canonical = await realpath(file);
    const state = await json(canonical);
    if (state.version !== 2)
        throw unsupportedFormat();
    await requireProject(state.cwd);
    let unowned;
    for (const layout of ["active", "legacy"]) {
        let storage;
        try {
            storage = await sessionStorage(state.cwd, state.sessionId, false, layout);
        }
        catch (e) {
            if (e.code === "ENOENT")
                continue;
            throw e;
        }
        try {
            assertOwnership(state, canonical, storage.storageDir, state.sessionId);
        }
        catch (e) {
            unowned = e;
            continue;
        }
        return { state, layout, canonical };
    }
    throw unowned ?? new Error("Invalid state identity");
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
