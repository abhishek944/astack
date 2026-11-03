#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checkAnswer, stopLocal, submissionResult, submitQuestion, watchAnswer, } from "./core.js";
import { serve } from "./local.js";
import { json, object, string } from "./model.js";
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => controller.abort(new Error("Decision observation cancelled")));
async function main() {
    const [command, ...args] = process.argv.slice(2);
    const { values } = parseArgs({
        args,
        options: {
            request: { type: "string" },
            "session-id": { type: "string" },
            cwd: { type: "string" },
            state: { type: "string" },
            backend: { type: "string" },
        },
    });
    if (command === "submit") {
        const request = object(await json(string(values.request, "--request")), "request");
        const backend = values.backend ?? "local";
        if (backend !== "local" && backend !== "here.now")
            throw new Error("--backend must be local or here.now");
        const state = await submitQuestion(request, {
            sessionId: string(values["session-id"], "--session-id"),
            cwd: string(values.cwd, "--cwd"),
            backend: backend,
        }, controller.signal);
        console.log(JSON.stringify(submissionResult(state)));
        return;
    }
    const file = string(values.state, "--state");
    if (command === "check")
        console.log(JSON.stringify(await checkAnswer(file, controller.signal)));
    else if (command === "watch")
        console.log(JSON.stringify({
            status: "answered",
            answer: await watchAnswer(file, controller.signal),
        }));
    else if (command === "serve")
        await serve(file, controller.signal);
    else if (command === "stop") {
        await stopLocal(file);
        console.log(JSON.stringify({ status: "stopped" }));
    }
    else
        throw new Error("Usage: submit --request FILE --session-id ID --cwd REPO [--backend local|here.now], or check|watch|stop --state FILE");
}
main().catch((error) => {
    console.error(JSON.stringify({
        isError: true,
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
});
