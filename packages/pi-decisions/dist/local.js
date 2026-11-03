import { createServer, } from "node:http";
import { archive, publicAsset } from "./core.js";
import { loadState, save } from "./model.js";
export async function serve(file, signal) {
    const state = await loadState(file);
    if (state.backend !== "local" || !state.capability)
        throw new Error("Not a local question state");
    let origin = "";
    const server = createServer(async (req, res) => {
        const send = (status, body, type = "text/plain; charset=utf-8") => {
            res.writeHead(status, {
                "Content-Type": type,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Cross-Origin-Resource-Policy": "same-origin",
            });
            res.end(body);
        };
        try {
            if (req.headers.host !== new URL(origin).host) {
                send(403, "Host not allowed");
                return;
            }
            const url = new URL(req.url ?? "/", origin);
            if (req.method === "POST" &&
                (url.pathname === "/answer" || url.pathname === "/stop")) {
                if (req.headers.origin !== origin ||
                    req.headers["x-decision-capability"] !== state.capability) {
                    send(403, "Submission requires this page's origin and capability");
                    return;
                }
                if (url.pathname === "/stop") {
                    send(200, "Stopped");
                    server.close();
                    return;
                }
                if (!req.headers["content-type"]?.startsWith("application/json")) {
                    send(415, "Use application/json");
                    return;
                }
                const chunks = [];
                for await (const chunk of req)
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                await archive(state, input);
                send(201, JSON.stringify({ saved: true }), "application/json");
                server.close();
                return;
            }
            if (req.method !== "GET") {
                send(405, "Method not allowed");
                return;
            }
            if (url.pathname === "/health") {
                send(200, state.revision);
                return;
            }
            const name = url.pathname === "/"
                ? "index.html"
                : decodeURIComponent(url.pathname.slice(1));
            const asset = await publicAsset(state, name);
            if (!asset) {
                send(404, "Not found");
                return;
            }
            const media = asset.type.startsWith("video/");
            const headers = {
                "Content-Type": asset.type,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Cross-Origin-Resource-Policy": "same-origin",
                "Content-Length": String(asset.bytes.length),
            };
            if (media)
                headers["Accept-Ranges"] = "bytes";
            if (media && req.headers.range) {
                const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
                const size = asset.bytes.length;
                const start = match?.[1]
                    ? Number(match[1])
                    : Math.max(0, size - Number(match?.[2]));
                const end = match?.[1] && match[2]
                    ? Math.min(Number(match[2]), size - 1)
                    : size - 1;
                if (!match ||
                    (!match[1] && !match[2]) ||
                    !Number.isSafeInteger(start) ||
                    !Number.isSafeInteger(end) ||
                    start >= size ||
                    start > end) {
                    res.writeHead(416, {
                        ...headers,
                        "Content-Length": "0",
                        "Content-Range": `bytes */${size}`,
                    });
                    res.end();
                    return;
                }
                const bytes = asset.bytes.subarray(start, end + 1);
                res.writeHead(206, {
                    ...headers,
                    "Content-Length": String(bytes.length),
                    "Content-Range": `bytes ${start}-${end}/${size}`,
                });
                res.end(bytes);
                return;
            }
            res.writeHead(200, headers);
            res.end(asset.bytes);
        }
        catch (e) {
            send(400, e instanceof SyntaxError
                ? "Invalid JSON"
                : e instanceof Error && !("code" in e)
                    ? e.message
                    : "Request failed");
        }
    });
    // This process owns only this assigned loopback socket, never a directory server root.
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing local server address");
    origin = `http://127.0.0.1:${address.port}`;
    state.url = `${origin}/`;
    state.status = "ready";
    await save(state.statePath, state);
    process.send?.({ ready: true });
    const stop = () => server.close();
    if (signal?.aborted)
        server.close();
    else
        signal?.addEventListener("abort", stop, { once: true });
    await new Promise((resolve, reject) => {
        server.once("close", resolve);
        server.once("error", reject);
    });
    signal?.removeEventListener("abort", stop);
}
