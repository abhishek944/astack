import { readFile } from "node:fs/promises";
import path from "node:path";
import { absoluteFile, hash, object, string, } from "./model.js";
const escapeHtml = (v) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
function fields(raw, allowed, name) {
    if (Object.keys(raw).some((key) => !allowed.includes(key)))
        throw new Error(`Unexpected ${name} fields. Use the direct mode/content interface only.`);
}
function mermaidFrame(code) {
    const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net;\">";
    const body = '<pre class="mermaid">' +
        escapeHtml(code) +
        '</pre><script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:true,securityLevel:"strict",theme:"dark"});</script>';
    return ('<iframe title="Diagram" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="' +
        escapeHtml(csp + body) +
        '"></iframe>');
}
export async function prepare(request) {
    const config = object(request, "submission");
    fields(config, [
        "questionId",
        "mode",
        "question",
        "content",
        "options",
        "recommended",
        "label",
    ], "submission");
    if (!["single", "multiple", "review"].includes(request.mode))
        throw new Error("mode must be single, multiple or review");
    if (request.mode === "review" &&
        (config.options !== undefined || config.recommended !== undefined))
        throw new Error("Review mode does not accept options or recommended");
    const optionInputs = request.mode === "review" ? [] : config.options;
    if (!Array.isArray(optionInputs) ||
        (request.mode !== "review" && !optionInputs.length))
        throw new Error("Choice options must be a nonempty array (use mode review for feedback only)");
    const assets = [], assetHashes = [], images = [];
    function asset(bytes, extension, contentType) {
        const digest = hash(bytes), name = `assets/${digest}.${extension}`;
        if (!assets.some((a) => a.path === name))
            assets.push({ path: name, contentType, bytes });
        assetHashes.push(digest);
        return name;
    }
    async function image(input) {
        const bytes = await readFile(await absoluteFile(input));
        if (bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
            return asset(bytes, "png", "image/png");
        if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
            return asset(bytes, "jpg", "image/jpeg");
        if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()))
            return asset(bytes, "gif", "image/gif");
        if (bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP")
            return asset(bytes, "webp", "image/webp");
        throw new Error("Images must be PNG, JPEG, GIF or WebP files");
    }
    async function video(input) {
        const bytes = await readFile(await absoluteFile(input)), ext = path.extname(input).toLowerCase();
        let contentType;
        if (ext === ".mp4" &&
            bytes.length >= 16 &&
            bytes.subarray(4, 8).toString() === "ftyp")
            contentType = "video/mp4";
        else if (ext === ".webm" &&
            bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
            bytes.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])))
            contentType = "video/webm";
        else
            throw new Error("Video must be an MP4 or WebM file with a matching container header");
        const name = asset(bytes, ext.slice(1), contentType);
        return `<video class="review-video" controls playsinline preload="metadata" aria-label="Recording"><source src="${name}" type="${contentType}">Your browser cannot play this recording.</video><p><a href="${name}" download>Download recording</a> if playback is unavailable.</p>`;
    }
    async function blocks(value) {
        if (value === undefined)
            return { content: [], html: "" };
        if (!Array.isArray(value))
            throw new Error("content must be an ordered array of blocks");
        const content = [], html = [];
        for (const item of value) {
            const raw = object(item, "content block");
            const allowed = raw.type === "text"
                ? ["type", "text"]
                : raw.type === "image"
                    ? ["type", "path", "alt", "caption"]
                    : raw.type === "video"
                        ? ["type", "path", "caption"]
                        : ["type", "code", "caption"];
            fields(raw, allowed, "content block");
            const caption = raw.caption === undefined
                ? undefined
                : string(raw.caption, "caption"), captionFields = caption === undefined ? {} : { caption };
            let body;
            if (raw.type === "text") {
                const text = string(raw.text, "text");
                content.push({ type: "text", text });
                body = `<p>${escapeHtml(text)}</p>`;
            }
            else if (raw.type === "image") {
                const input = string(raw.path, "image.path"), alt = string(raw.alt, "image.alt"), name = await image(input), index = images.push({ image: name, label: alt }) - 1;
                content.push({ type: "image", path: input, alt, ...captionFields });
                body = `<button class="expand" type="button" data-image="${index}" aria-label="Expand image: ${escapeHtml(alt)}"><img src="${name}" alt="${escapeHtml(alt)}"></button>`;
            }
            else if (raw.type === "video") {
                const input = string(raw.path, "video.path");
                content.push({ type: "video", path: input, ...captionFields });
                body = await video(input);
            }
            else if (raw.type === "mermaid") {
                const code = string(raw.code, "mermaid.code");
                content.push({ type: "mermaid", code, ...captionFields });
                body = mermaidFrame(code);
            }
            else
                throw new Error("Content block type must be text, image, video or mermaid");
            html.push(`<figure>${body}${caption === undefined ? "" : `<figcaption>${escapeHtml(caption)}</figcaption>`}</figure>`);
        }
        return { content, html: html.join("") };
    }
    const general = await blocks(config.content);
    const question = {
        questionId: request.questionId,
        mode: request.mode,
        question: string(request.question, "question"),
        content: general.content,
        options: [],
    };
    const options = [];
    for (const item of optionInputs) {
        const raw = object(item, "option");
        fields(raw, ["id", "label", "content"], "option");
        const id = string(raw.id, "option.id"), label = string(raw.label, "option.label");
        if (question.options.some((o) => o.id === id))
            throw new Error("Option IDs must be unique");
        const prepared = await blocks(raw.content);
        question.options.push({ id, label, content: prepared.content });
        options.push({ id, label, content: prepared.html });
    }
    if (request.label !== undefined)
        question.label = string(request.label, "label");
    if (request.recommended !== undefined) {
        question.recommended = string(request.recommended, "recommended");
        if (!question.options.some((o) => o.id === question.recommended))
            throw new Error("recommended must name an option ID");
    }
    const publicText = JSON.stringify({
        question: question.question,
        questionId: question.questionId,
        label: question.label,
        options,
        visual: general.html,
        images,
    });
    if (/(?:file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\\\)/i.test(publicText))
        throw new Error("Public presentation contains a local filesystem path; put source paths only in media path fields");
    return {
        question,
        options,
        visual: general.html,
        images,
        assetHashes,
        assets,
    };
}
export function render(input, revision, backend, capability) {
    const q = input.question, reviewOnly = q.mode === "review";
    const cards = input.options
        .map((o) => `<article class="card"><label class="choice"><input type="${q.mode === "multiple" ? "checkbox" : "radio"}" name="choice" value="${escapeHtml(o.id)}"><span><strong>${escapeHtml(o.label)}</strong>${q.recommended === o.id ? "<em>Recommended</em>" : ""}</span></label>${o.content}</article>`)
        .join("");
    const data = JSON.stringify({
        question: q.questionId,
        revision,
        backend,
        capability,
        images: input.images,
    }).replace(/</g, "\\u003c");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(q.label ?? (reviewOnly ? "Your review" : "Your decision"))}</title><style>
:root{color-scheme:dark light;font:17px/1.5 system-ui;background:#0c1120;color:#edf2ff}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:auto;padding:48px 24px 100px}h1{font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.2;max-width:950px}p{white-space:pre-wrap;color:#bfcae1}.eyebrow{color:#9caeff;letter-spacing:.12em;text-transform:uppercase;font-size:.75rem}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:28px 0}.card{min-width:0;background:#151d30;border:1px solid #39445f;border-radius:16px;padding:20px}.card:has(input:checked){border-color:#a9b9ff;box-shadow:0 0 0 2px #a9b9ff}.choice{display:flex;gap:12px;cursor:pointer;align-items:flex-start}.choice input{margin-top:7px;accent-color:#b5c2ff}strong,em{display:block}em{font-size:.75rem;color:#a9b9ff}button,textarea{font:inherit}button{border:1px solid #8498d0;border-radius:9px;padding:10px 18px;background:#b8c7ff;color:#111a30;cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #ffce6a;outline-offset:4px}button:disabled{opacity:.6;cursor:wait}.expand{display:block;width:100%;padding:0;overflow:hidden;background:#090d17}.expand img{width:100%;display:block;max-height:360px;object-fit:contain}.review-video{display:block;width:100%;max-height:70vh;background:#000}a{color:inherit}figure{margin:16px 0}figcaption{font-size:.85rem;color:inherit;opacity:.8;margin-top:8px}iframe{width:100%;height:400px;border:1px solid #455274;background:#fff}textarea{display:block;width:100%;min-height:130px;background:#151d30;color:#edf2ff;border:1px solid #64749c;border-radius:10px;padding:14px;margin:10px 0 20px}.actions{display:flex;gap:12px;flex-wrap:wrap}.secondary{background:transparent;color:#cbd6f1}#status{margin-top:16px;white-space:pre-wrap}dialog{max-width:96vw;max-height:96vh;background:#111a2c;color:#fff;border:1px solid #8a9bc9;border-radius:12px}dialog img{display:block;max-width:88vw;max-height:80vh;object-fit:contain}.close{float:right}footer{margin-top:32px;font-size:.8rem;color:#a4afc7}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}main{padding:24px 16px 64px}}@media(prefers-color-scheme:light){:root{background:#f4f6fc;color:#122042}.card,textarea{background:white;color:#122042}p{color:#4c5b78}.secondary{color:#223665}iframe{border-color:#bdc7df}}</style></head><body><main><div class="eyebrow">${reviewOnly ? "Review" : "A question for you"}</div><h1>${escapeHtml(q.question)}</h1>${input.visual}<form id="answer">${cards ? `<div class="grid">${cards}</div>` : ""}<label for="comments">${reviewOnly ? "Your review" : "Comments / why <span>(or tell us why none fit)</span>"}</label><textarea id="comments" placeholder="${reviewOnly ? "What worked? What needs changing?" : "Explain your preference, combine ideas, or suggest something else"}"></textarea><div class="actions"><button id="submit" type="submit" disabled>${reviewOnly ? "Send review" : "Send response"}</button>${reviewOnly ? "" : '<button class="secondary" id="clear" type="button">Clear selection</button>'}</div><div id="status" role="status" aria-live="polite"></div></form><footer>${reviewOnly ? "Submit your comments to share your review." : `${q.mode === "multiple" ? "Choose any number of options." : "Choose one option."} Comments-only responses are welcome.`}${backend === "here.now" ? " This link is public. Do not submit secrets." : " Served only on this machine."}</footer></main><dialog id="viewer"><button type="button" class="close" id="close">Close</button><h2 id="image-title"></h2><img id="full-image" alt=""></dialog><script>
const config=${data};const form=document.getElementById('answer'),status=document.getElementById('status'),submit=document.getElementById('submit'),commentsField=document.getElementById('comments');let sending=false;
function updateSubmit(){submit.disabled=sending||(!form.querySelector('input:checked')&&!commentsField.value.trim())}form.addEventListener('input',updateSubmit);form.addEventListener('change',updateSubmit);updateSubmit();
const clearButton=document.getElementById('clear');if(clearButton)clearButton.onclick=()=>{form.querySelectorAll('input').forEach(e=>e.checked=false);commentsField.focus();updateSubmit()};
document.querySelectorAll('[data-image]').forEach(button=>button.onclick=()=>{const item=config.images[Number(button.dataset.image)];document.getElementById('image-title').textContent=item.label;const image=document.getElementById('full-image');image.src=item.image;image.alt=item.label;document.getElementById('viewer').showModal()});
document.getElementById('close').onclick=()=>document.getElementById('viewer').close();
form.onsubmit=async event=>{event.preventDefault();const selected_ids=[...form.querySelectorAll('input:checked')].map(e=>e.value);const comments=commentsField.value;if(!selected_ids.length&&!comments.trim()){status.textContent='Choose an option or add comments.';return}const payload={question:config.question,revision:config.revision,selected_ids:config.backend==='here.now'?JSON.stringify(selected_ids):selected_ids,comments};const body=JSON.stringify(payload);if(config.backend==='here.now'&&new TextEncoder().encode(body).length>16384){status.textContent='here.now allows 16 KB per answer record. Your response was not sent or shortened. Please shorten the comments.';return}sending=true;updateSubmit();status.textContent='Sending…';try{const headers={'Content-Type':'application/json'};if(config.backend==='local')headers['X-Decision-Capability']=config.capability;const response=await fetch(config.backend==='local'?'/answer':'/.herenow/data/answers',{method:'POST',headers,body});if(!response.ok)throw new Error('Submission failed ('+response.status+'). '+await response.text());status.textContent='Response saved. You can return to Pi.';form.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=true)}catch(error){status.textContent=error.message;sending=false;updateSubmit()}};
</script></body></html>`;
}
export function dataManifest() {
    return {
        collections: {
            answers: {
                fields: {
                    question: { type: "string", required: true },
                    revision: { type: "string", required: true },
                    selected_ids: { type: "string", required: true },
                    comments: { type: "string", required: true },
                },
                access: {
                    read: "owner",
                    insert: "public",
                    update: "owner",
                    delete: "owner",
                },
            },
        },
    };
}
