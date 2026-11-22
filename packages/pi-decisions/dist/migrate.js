import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readArchived } from "./core.js";
import { hash, inside, inspectState, loadState, optionalJson, questionPaths, save, sessionStorage, } from "./model.js";
// A refused connection shows only that the recorded address accepted nothing at this
// instant. It does not prove the process exited, that an accepted request handler will not
// still archive, or that no other launched writer holds the question. The probe therefore
// refuses a provably answering delivery; the owning session still has to confirm
// quiescence, and nothing here signals, stops or inspects a process.
async function requireStoppedWriter(state, signal) {
    if (!state.url)
        throw new Error("Saved local delivery has no address. Inspect the question before relocation; nothing was moved.");
    const url = new URL(state.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port)
        throw new Error("Saved local delivery address is not a loopback HTTP origin. Inspect the question before relocation; nothing was moved.");
    let status;
    let revision;
    try {
        const response = await fetch(new URL("/health", url), {
            redirect: "error",
            signal,
        });
        status = response.status;
        revision = await response.text();
    }
    catch (e) {
        if (e instanceof TypeError &&
            "cause" in e &&
            e.cause?.code === "ECONNREFUSED")
            return;
        throw e;
    }
    throw new Error(`The recorded local delivery still answers (HTTP ${status}${revision === state.revision ? ", same revision" : ""}). Stop it with the build that created it before relocating. No process was touched and nothing was moved.`);
}
const hashedAsset = /^assets\/([0-9a-f]{64})\.[A-Za-z0-9]+$/;
// Reads every declared bundle file with a containment check and verifies content-addressed
// asset names, so a missing, truncated or replaced asset is visible.
async function bundleBytes(state) {
    const files = new Map();
    for (const file of state.files) {
        const source = await realpath(path.join(state.bundleDir, file.path));
        if (!inside(state.bundleDir, source))
            throw new Error("Saved bundle file escapes its question directory");
        const bytes = await readFile(source);
        const digest = hashedAsset.exec(file.path)?.[1];
        if (digest && hash(bytes) !== digest)
            throw new Error(`Saved bundle content does not match its recorded digest: ${file.path}`);
        files.set(file.path, bytes);
    }
    return files;
}
// Immutable question identity and content. The whole `question` value and the complete
// declared bundle metadata (path plus content type) are compared, because the revision
// string alone would not notice an edited option label or a changed declared type.
// Genuinely mutable runtime fields — url, status, capability, warnings, error,
// publication, slug — stay excluded, so a restarted delivery is not a conflict.
function immutableDifference(source, target) {
    if (target.questionId !== source.questionId)
        return "its question identity differs";
    if (target.sessionId !== source.sessionId)
        return "its session identity differs";
    if (target.revision !== source.revision)
        return "its question revision differs";
    if (target.backend !== source.backend)
        return "its delivery backend differs";
    if (target.cwd !== source.cwd)
        return "its project root differs";
    if (!isDeepStrictEqual(target.question, source.question))
        return "its question content differs";
    if (!isDeepStrictEqual(target.files, source.files))
        return "its declared bundle metadata differs";
    return;
}
function inventoryDifference(source, target) {
    if (target.size !== source.size)
        return "its declared bundle inventory differs";
    for (const [name, bytes] of source) {
        const other = target.get(name);
        if (!other)
            return `its bundle is missing ${name}`;
        if (!other.equals(bytes))
            return `its bundle bytes differ for ${name}`;
    }
    return;
}
// The archived answer is immutable once linked, but a target may legitimately hold an
// answer the source never had (a later answer after an earlier migration attempt).
async function archiveDifference(source, target) {
    const sourceAnswer = await optionalJson(source.responsePath);
    const targetAnswer = await optionalJson(target.responsePath);
    if (sourceAnswer && !targetAnswer)
        return "its archived answer is missing while the source holds one";
    if (!sourceAnswer || !targetAnswer)
        return;
    await readArchived(source);
    await readArchived(target);
    const [from, to] = await Promise.all([
        readFile(source.responsePath),
        readFile(target.responsePath),
    ]);
    return from.equals(to) ? undefined : "its archived answer differs";
}
async function ownedTarget(statePath) {
    try {
        return await loadState(statePath);
    }
    catch {
        throw new Error(`${statePath} exists without a readable state of this project and session, possibly an incomplete earlier claim. Inspect it; nothing was moved or overwritten.`);
    }
}
export async function migrateQuestion(stateFile, signal) {
    const { state, layout, canonical } = await inspectState(stateFile);
    const result = (outcome, to) => ({
        questionId: state.questionId,
        from: canonical,
        to,
        outcome,
    });
    const answer = await optionalJson(state.responsePath);
    // The same narrow eligibility gates before any success, including the active no-op; an
    // active copy whose archive disappeared must not be reported as intact.
    if (state.status !== "ready")
        throw new Error(`Only a ready question can be relocated (current status: ${state.status}). Resolve it with the build that created it; nothing was moved.`);
    // Narrowed to the observed batch. An unanswered local question can still receive an
    // answer into the legacy paths, and a hosted question can be answered through its public
    // link; neither can be checked for quiescence here, so both are refused instead of
    // being reported as preserved.
    if (state.backend !== "local")
        throw new Error("Only an answered local question can be relocated. A hosted question can still be answered while it is copied; nothing was moved.");
    if (!answer)
        throw new Error("This question has no archived answer yet, so an existing delivery could still archive into the old location. Answer it first or resubmit it with a new questionId; nothing was moved.");
    await readArchived(state);
    if (layout === "active") {
        // Nothing to move, so no port probe and no mutation.
        await bundleBytes(state);
        return result("already-migrated", canonical);
    }
    await requireStoppedWriter(state, signal);
    const source = await bundleBytes(state);
    const storage = await sessionStorage(state.cwd, state.sessionId, true);
    const target = questionPaths(storage.storageDir, state.questionId);
    // The same single exclusive claim SubmitQuestion uses. A losing writer sees EEXIST and
    // either validates the finished state or fails loudly; there is no no-replace rename.
    let claimed = false;
    try {
        try {
            await mkdir(target.questionDir, { mode: 0o700 });
            claimed = true;
        }
        catch (e) {
            if (e.code !== "EEXIST")
                throw e;
            const existing = await ownedTarget(target.statePath);
            const difference = immutableDifference(state, existing) ??
                inventoryDifference(source, await bundleBytes(existing)) ??
                (await archiveDifference(state, existing));
            if (difference)
                throw new Error(`${target.questionDir} already exists but ${difference}. Nothing was moved or overwritten.`);
            return result("already-migrated", target.statePath);
        }
        const bundleDir = target.bundleDir;
        for (const [name, bytes] of source) {
            const destination = path.join(bundleDir, name);
            if (!inside(bundleDir, destination))
                throw new Error("Saved bundle file escapes the relocation target");
            await mkdir(path.dirname(destination), {
                recursive: true,
                mode: 0o700,
            });
            await writeFile(destination, bytes, { mode: 0o600 });
        }
        await writeFile(target.responsePath, await readFile(state.responsePath), {
            mode: 0o600,
        });
        const migrated = {
            ...state,
            cwd: storage.cwd,
            storageDir: storage.storageDir,
            responsePath: target.responsePath,
            statePath: target.statePath,
            bundleDir: target.bundleDir,
        };
        // Commit point: the claimed directory becomes a question only once its state exists.
        await save(target.statePath, migrated);
        claimed = false;
        const finalState = await loadState(target.statePath, state.sessionId);
        await readArchived(finalState);
        return result("relocated", target.statePath);
    }
    finally {
        // Only a claim this call created is rolled back; a committed or pre-existing target
        // is never removed.
        if (claimed)
            await rm(target.questionDir, { recursive: true, force: true });
    }
}
