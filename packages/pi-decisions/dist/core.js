import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, unlink, writeFile, } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ApiError, publish, records } from "./herenow.js";
import { hash, inside, loadState, normalize, optionalJson, privateDirectory, questionId, save, sessionStorage, } from "./model.js";
import { dataManifest, prepare, render } from "./render.js";
export { loadState } from "./model.js";
export const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
const children = new Map();
export const shellQuote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
export function watcherCommand(statePath) {
    return [process.execPath, cliPath, "watch", "--state", statePath]
        .map(shellQuote)
        .join(" ");
}
export async function findState(id, cwd, sessionId) {
    const storage = await sessionStorage(cwd, sessionId);
    return loadState(path.join(storage.storageDir, questionId(id), "state.json"), sessionId);
}
async function startLocal(state) {
    const child = spawn(process.execPath, [cliPath, "serve", "--state", state.statePath], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    children.set(state.statePath, child);
    child.once("exit", () => {
        if (children.get(state.statePath) === child)
            children.delete(state.statePath);
    });
    await new Promise((resolve, reject) => {
        const failed = (error) => {
            reject(error);
        };
        const exited = (code) => reject(new Error(`Local question server exited before readiness (${code})`));
        child.once("error", failed);
        child.once("exit", exited);
        child.once("message", (message) => {
            child.off("error", failed);
            child.off("exit", exited);
            if (typeof message === "object" &&
                message &&
                "ready" in message &&
                message.ready === true)
                resolve();
            else
                reject(new Error("Local question server failed to start"));
        });
    });
    child.disconnect();
    child.unref();
}
export async function stopLocal(file) {
    const child = children.get(file);
    if (child) {
        child.kill("SIGTERM");
        children.delete(file);
        return;
    }
    const state = await loadState(file);
    if (state.backend !== "local" || !state.url || !state.capability)
        return;
    const url = new URL(state.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
        throw new Error("Invalid local server address");
    try {
        const response = await fetch(new URL("/stop", url), {
            method: "POST",
            headers: {
                Origin: url.origin,
                "X-Decision-Capability": state.capability,
            },
            redirect: "error",
        });
        if (!response.ok)
            throw new Error("Local server cleanup was rejected");
    }
    catch (e) {
        if (e instanceof TypeError &&
            "cause" in e &&
            e.cause?.code === "ECONNREFUSED")
            return;
        throw e;
    }
}
export async function stopOwnedChildren() {
    for (const child of children.values())
        child.kill("SIGTERM");
    children.clear();
}
export async function submitQuestion(request, context, signal) {
    const id = questionId(request.questionId);
    const backend = context.backend;
    if (!["local", "here.now"].includes(backend))
        throw new Error("pi-decisions.backend must be local or here.now");
    const input = await prepare({ ...request, questionId: id });
    const storage = await sessionStorage(context.cwd, context.sessionId, true);
    const revision = hash(JSON.stringify({ question: input.question, assets: input.assetHashes }));
    if (backend === "here.now") {
        for (const selected_ids of [
            [],
            ...input.question.options.map((option) => [option.id]),
        ]) {
            if (Buffer.byteLength(JSON.stringify({
                question: id,
                revision,
                selected_ids: JSON.stringify(selected_ids),
                comments: "",
            }), "utf8") > 16384) {
                throw new Error("Question/option identity exceeds the mandatory here.now 16 KB answer record boundary. No publication was attempted.");
            }
        }
    }
    const questionDir = path.join(storage.storageDir, id), statePath = path.join(questionDir, "state.json");
    try {
        await mkdir(questionDir, { mode: 0o700 });
    }
    catch (e) {
        if (e.code !== "EEXIST")
            throw e;
        const existing = await loadState(statePath, context.sessionId);
        if (existing.revision !== revision)
            throw new Error("This questionId has immutable content. Submit changed content with a new questionId.");
        if (existing.status !== "ready")
            throw new Error("Previous submission is incomplete or failed. Inspect its state before any retry; no automatic republish was attempted.");
        if (existing.backend === "local" &&
            !(await optionalJson(existing.responsePath))) {
            try {
                const response = await fetch(new URL("/health", existing.url), {
                    redirect: "error",
                    signal,
                });
                if (!response.ok || (await response.text()) !== existing.revision)
                    throw new Error("Local server identity mismatch");
            }
            catch (e) {
                if (!(e instanceof TypeError &&
                    "cause" in e &&
                    e.cause?.code === "ECONNREFUSED"))
                    throw e;
                await startLocal(existing);
            }
        }
        return loadState(statePath, context.sessionId);
    }
    const bundleDir = path.join(questionDir, "public");
    await privateDirectory(path.join(bundleDir, "assets"));
    const state = {
        version: 2,
        sessionId: context.sessionId,
        ...storage,
        questionId: id,
        revision,
        backend,
        question: input.question,
        responsePath: path.join(questionDir, "response.json"),
        statePath,
        bundleDir,
        files: [],
        status: "prepared",
    };
    if (backend === "local")
        state.capability = randomBytes(32).toString("base64url");
    const html = render(input, revision, backend, state.capability);
    await writeFile(path.join(bundleDir, "index.html"), html, { mode: 0o600 });
    state.files.push({
        path: "index.html",
        contentType: "text/html; charset=utf-8",
    });
    for (const asset of input.assets) {
        await writeFile(path.join(bundleDir, asset.path), asset.bytes, {
            mode: 0o600,
        });
        state.files.push({ path: asset.path, contentType: asset.contentType });
    }
    if (backend === "here.now") {
        await privateDirectory(path.join(bundleDir, ".herenow"));
        await writeFile(path.join(bundleDir, ".herenow", "data.json"), JSON.stringify(dataManifest()), { mode: 0o600 });
        state.files.push({
            path: ".herenow/data.json",
            contentType: "application/json",
        });
    }
    await save(statePath, state);
    try {
        if (backend === "local")
            await startLocal(state);
        else
            await publish(state, signal);
    }
    catch (e) {
        const current = await loadState(statePath, context.sessionId);
        if (current.status !== "ready") {
            current.status = "failed";
            current.error = e instanceof Error ? e.message : String(e);
            await save(statePath, current);
        }
        throw e;
    }
    return loadState(statePath, context.sessionId);
}
export function submissionResult(state) {
    return {
        questionId: state.questionId,
        backend: state.backend,
        url: state.url,
        responsePath: state.responsePath,
        statePath: state.statePath,
        status: state.status,
        public: state.backend === "here.now",
        warnings: state.warnings,
    };
}
export async function archive(state, input, recordId = null) {
    const answer = normalize(state, input, recordId);
    const temp = `${state.responsePath}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(answer, null, 2)}\n`, {
        mode: 0o600,
    });
    try {
        await link(temp, state.responsePath);
    }
    catch (e) {
        if (e.code !== "EEXIST")
            throw e;
    }
    finally {
        await unlink(temp);
    }
    return readArchived(state);
}
async function readArchived(state) {
    const answer = await optionalJson(state.responsePath);
    if (!answer ||
        answer.questionId !== state.questionId ||
        answer.revision !== state.revision ||
        answer.sessionId !== state.sessionId)
        throw new Error("Archived answer does not belong to this question");
    // Rebuild labels from trusted question data, not browser-derived fields.
    return {
        ...normalize(state, {
            question: state.questionId,
            revision: state.revision,
            selected_ids: answer.selectedIds,
            comments: answer.response,
        }, answer.recordId),
        timestamp: answer.timestamp,
    };
}
export async function checkAnswer(file, signal) {
    const state = await loadState(file);
    if (await optionalJson(state.responsePath))
        return { status: "answered", answer: await readArchived(state) };
    if (state.status !== "ready")
        throw new Error("Question delivery is not ready");
    if (state.backend === "here.now") {
        for await (const record of records(state, signal)) {
            try {
                normalize(state, record.data, record.id);
            }
            catch {
                continue;
            }
            return {
                status: "answered",
                answer: await archive(state, record.data, record.id),
            };
        }
    }
    return { status: "waiting" };
}
export async function watchAnswer(file, signal) {
    try {
        for (;;) {
            try {
                const result = await checkAnswer(file, signal);
                if (result.status === "answered")
                    return result.answer;
            }
            catch (e) {
                if (e instanceof ApiError &&
                    e.status === 429 &&
                    e.retryAfterMs !== undefined) {
                    await delay(e.retryAfterMs, undefined, { signal });
                    continue;
                }
                throw e;
            }
            await delay(1500, undefined, { signal });
        }
    }
    finally {
        const state = await loadState(file);
        if (state.backend === "local")
            await stopLocal(file);
    }
}
export async function publicAsset(state, name) {
    const file = state.files.find((f) => f.path === name && !f.path.startsWith(".herenow/"));
    if (!file)
        return;
    const resolved = await realpath(path.join(state.bundleDir, file.path));
    if (!inside(state.bundleDir, resolved))
        throw new Error("Public asset escapes bundle");
    return { bytes: await readFile(resolved), type: file.contentType };
}
