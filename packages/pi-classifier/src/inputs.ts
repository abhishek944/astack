import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  ClassifierError,
  isRecord,
  type ClassifyParams,
  type ExtractParams,
  type PreparedImage,
  type PreparedLocalImage,
  type PreparedInput,
  type PreparedMedia,
  type ResolvedModel,
} from "./types.js";
import { hasBox } from "./validation.js";
import { imageReferences } from "./image-content.js";

/** Programmatic image ingress. Never accepted as model-facing tool arguments. */
export interface MemoryImage {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export async function prepareInput(
  params: ClassifyParams,
  route: ResolvedModel,
  cwd: string,
  signal?: AbortSignal,
  memoryImages: readonly MemoryImage[] = [],
): Promise<PreparedInput> {
  const imageCount = (params.images?.length ?? 0) + memoryImages.length;
  if (imageCount && !route.images)
    throw new ClassifierError("capability", "The selected model does not support images, or experimental Jev images are disabled.");
  if (hasBox(params.questions) && (!route.box || !imageCount))
    throw new ClassifierError("capability", "box requires an enabled Jev 1.14 model, experimentalImages/experimentalBox and an image.");
  if (params.mode === "web_grounding" && route.api !== "perplexity-decisions")
    throw new ClassifierError("capability", "Web grounding is supported only by Perplexity Decisions routes.");
  if (params.maxStaleness !== undefined && params.mode !== "web_grounding")
    throw new ClassifierError("input", "maxStaleness requires mode: web_grounding on a Perplexity route.");
  if (route.api === "cloudflare-clairic")
    throw new ClassifierError("capability", "Clairic extraction uses classify_extract with fields, not classify questions.");
  const liquidQuestions = ["bool", "choice", "score", "text", "number", "date", "spans", "boxes", "estimate", "multi_choice", "box"];
  const decisionQuestions = ["bool", "choice", "score", "box", "locate"];
  const allowed = route.api === "liquid-system-one" ? liquidQuestions : decisionQuestions;
  const unsupported = Object.values(params.questions).find((question) => !allowed.includes(question.type));
  if (unsupported)
    throw new ClassifierError("capability", "The selected route does not support " + unsupported.type + " questions.");
  const locate = Object.values(params.questions).some((question) => question.type === "locate");
  if (locate) {
    const v13 = ["pplx-decider-v1.3", "pplx-decider-flash-v1.3", "pplx-decider-latest", "pplx-decider-flash-latest"];
    if (route.api !== "perplexity-decisions" || !v13.includes(route.model))
      throw new ClassifierError("capability", "locate requires a Perplexity v1.3 model or its latest alias.");
    if (imageCount > 0)
      throw new ClassifierError("input", "locate requires a string state without images.");
    if (typeof params.state !== "string")
      throw new ClassifierError("input", "locate requires a string state. Offsets are defined only for text.");
  }
  const clef = route.api === "cloudflare-system-one" && route.images;
  const liquid = route.api === "liquid-system-one";
  const maxImages = liquid || route.api === "perplexity-decisions" ? 8 : clef ? 4 : 5;
  if (imageCount > maxImages)
    throw new ClassifierError("input", "The selected route accepts at most " + maxImages + " images in this package.");
  if (imageReferences(params.state).length && !["system-one", "openai-decisions", "perplexity-decisions"].includes(route.api))
    throw new ClassifierError("capability", "This route does not support explicit image references in state; use shared image paths instead.");
  for (const question of Object.values(params.questions)) {
    if (imageReferences(question.instructions).length && !["system-one", "openai-decisions"].includes(route.api))
      throw new ClassifierError("capability", "Image references in question instructions require Jev or OpenAI Decisions.");
    if ("criteria" in question && question.criteria && Object.values(question.criteria).some((entry) => imageReferences(entry).length) && route.api !== "system-one")
      throw new ClassifierError("capability", "Image references in criteria require a Jev assets-protocol route.");
  }
  // Reject unsupported URL placement before opening any local files.
  for (const source of params.images ?? []) {
    if (typeof source !== "string" && "url" in source) {
      if (route.api !== "openai-decisions")
        throw new ClassifierError("capability", "Hosted image URLs are supported only by OpenAI Decisions routes. No URL was fetched.");
      try {
        const url = new URL(source.url);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash)
          throw new Error();
      } catch {
        throw new ClassifierError("input", "Image URLs must be absolute HTTP(S) URLs without credentials or fragments.");
      }
    }
  }
  const images: PreparedImage[] = [];
  let totalBytes = 0;
  const sources = [
    ...(params.images ?? []).map((source) => ({ source })),
    ...memoryImages.map((memory) => ({ memory })),
  ];
  for (const entry of sources) {
    cancelled(signal);
    const maxBytes = (clef ? 4 : 5) * 1024 * 1024;
    let image: PreparedLocalImage;
    let id: string | undefined;
    if ("memory" in entry) {
      image = await prepareImageBytes(entry.memory.bytes, signal, maxBytes, entry.memory.mimeType);
    } else {
      const source = entry.source;
      if (typeof source !== "string" && "url" in source) {
        images.push({ id: source.id, url: source.url });
        continue;
      }
      image = await loadLocalImage(typeof source === "string" ? source : source.path, cwd, signal, maxBytes);
      if (typeof source !== "string") id = source.id;
    }
    totalBytes += Buffer.byteLength(image.data, "base64");
    if (totalBytes > (clef ? 8 : 10) * 1024 * 1024)
      throw new ClassifierError("input", "Images exceed the selected route's total upload byte limit.");
    if (route.api === "system-one") {
      if (image.mimeType === "image/webp")
        throw new ClassifierError("input", "Jev image assets accept PNG and JPEG only.");
      const pixels = image.width * image.height;
      if (image.width < 280 || image.width > 1568 || image.height < 280 || image.height > 1568 || pixels < 78_400 || pixels > 2_458_624)
        throw new ClassifierError("input", "Resize or pad Jev images before sending: each side must be 280–1568 pixels and total area 78400–2458624 pixels. Images are not silently resized.");
    }
    if (liquid) {
      const patches = Math.ceil(image.width / 32) * Math.ceil(image.height / 32);
      if (patches > 10_000 || image.width > image.height * 100 || image.height > image.width * 100)
        throw new ClassifierError("input", "Liquid images must stay within 10000 32×32 patches and a 100:1 aspect ratio. Images are not silently resized.");
    }
    if (route.api === "perplexity-decisions" && Math.ceil(image.width / 32) * Math.ceil(image.height / 32) > 2048)
      throw new ClassifierError("input", "Resize Perplexity images to at most 2048 tiles of 32×32 pixels before classifying.");
    images.push(id === undefined ? image : { ...image, id });
  }
  const media = await prepareMedia(params.media ?? [], route, cwd, signal);
  return {
    state: params.state,
    questions: params.questions,
    images,
    media,
    ...(params.mode !== undefined ? { mode: params.mode } : {}),
    ...(params.maxStaleness !== undefined ? { maxStaleness: params.maxStaleness } : {}),
  };
}

/** Bounded, fully decoded local image; shared by uploads and local box rendering. */
export async function loadLocalImage(
  path: string,
  cwd: string,
  signal?: AbortSignal,
  maxBytes = 5 * 1024 * 1024,
): Promise<PreparedLocalImage> {
  cancelled(signal);
  try {
    if (/^[a-z]+:/i.test(path)) throw new Error();
    const root = await realpath(cwd);
    const target = resolve(root, path);
    const inside = relative(root, target);
    if (!inside || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) throw new Error();
    // Reject symlink components, not just the final image.
    let current = root;
    for (const part of inside.split(sep)) {
      current = resolve(current, part);
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || (current === target && !entry.isFile()) || (current !== target && !entry.isDirectory())) throw new Error();
    }
    if (await realpath(target) !== target) throw new Error();
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      // Verify the opened object as well: pre-open path checks alone are raceable.
      await verifyOpenedPath(file.fd, root, signal);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error();
      // A bounded read also handles files grown concurrently after stat().
      const buffer = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        cancelled(signal);
        const read = await file.read(buffer, offset, buffer.length - offset, null);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset > maxBytes) throw new Error();
      bytes = buffer.subarray(0, offset);
    } finally { await file.close(); }
    return await prepareImageBytes(bytes, signal, maxBytes);
  } catch (error) {
    cancelled(signal);
    if (error instanceof ClassifierError) throw error;
    throw new ClassifierError("input", "Images must be non-animated PNG/JPEG/WebP regular files inside cwd, without symlinks, within the documented byte limit and 16 megapixels each.");
  }
}

/** The same full-decode boundary for files and transient Driver captures. */
async function prepareImageBytes(
  input: Uint8Array,
  signal: AbortSignal | undefined,
  maxBytes: number,
  declaredMime?: MemoryImage["mimeType"],
): Promise<PreparedLocalImage> {
  cancelled(signal);
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > maxBytes)
    throw new ClassifierError("input", "Image bytes exceed the selected route's limit.");
  try {
    const bytes = Buffer.from(input);
    const meta = await sharp(bytes, { limitInputPixels: 16_777_216 }).metadata();
    if (!meta.width || !meta.height || !["png", "jpeg", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw new Error();
    const mimeType = meta.format === "jpeg" ? "image/jpeg" : meta.format === "png" ? "image/png" : "image/webp";
    if (declaredMime !== undefined && declaredMime !== mimeType) throw new Error();
    await decodeImage(bytes, signal);
    cancelled(signal);
    return { data: bytes.toString("base64"), mimeType, width: meta.width, height: meta.height };
  } catch (error) {
    cancelled(signal);
    if (error instanceof ClassifierError) throw error;
    throw new ClassifierError("input", "Image bytes must decode as a still PNG/JPEG/WebP matching the declared MIME type, within 16 megapixels.");
  }
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ClassifierError("aborted", "Classification was cancelled.");
}

async function decodeImage(bytes: Buffer, signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  // Output through a raw pipeline decodes every pixel and honors the native timeout.
  const decoder = sharp(bytes, { limitInputPixels: 16_777_216, failOn: "warning" }).timeout({ seconds: 10 }).raw();
  let cancel = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () => { decoder.destroy(); reject(new ClassifierError("aborted", "Classification was cancelled.")); };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => { decoder.destroy(); reject(new ClassifierError("input", "Image decoding timed out.")); }, 10_000);
      // Keep a rejection handler attached even after cancellation destroys the pipeline.
      decoder.toBuffer().then(() => resolve(), reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

const execFileAsync = promisify(execFile);

/** Verify containment of the opened descriptor, not a raceable pre-open path. */
export async function verifyOpenedPath(fd: number, root: string, signal?: AbortSignal): Promise<void> {
  let openedPath: string;
  if (process.platform === "linux") openedPath = await realpath("/proc/self/fd/" + fd);
  else if (process.platform === "darwin") {
    // Node does not expose F_GETPATH; the OS utility queries this exact descriptor.
    const { stdout } = await execFileAsync("/usr/sbin/lsof", ["-a", "-p", String(process.pid), "-d", String(fd), "-Fn"], {
      timeout: 3000, maxBuffer: 8192, ...(signal ? { signal } : {}),
    });
    const paths = stdout.split("\n").filter((line) => line.startsWith("n"));
    if (paths.length !== 1) throw new Error();
    openedPath = paths[0]!.slice(1);
  } else throw new ClassifierError("capability", "Safe local file loading currently supports macOS and Linux only. Inline text/JSON and hosted-image classification remain available.");
  const inside = relative(root, openedPath);
  if (!inside || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) throw new Error();
}

/** Detect container types by magic bytes; duration and codec compatibility remain provider-owned. */
function mediaMime(bytes: Buffer, type: "audio" | "video"): string {
  const ascii = (start: number, value: string) =>
    bytes.subarray(start, start + value.length).toString("ascii") === value;
  if (type === "audio") {
    if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
    if (ascii(0, "ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
    if (ascii(0, "fLaC")) return "audio/flac";
    if (ascii(0, "OggS")) return "audio/ogg";
    throw new ClassifierError("input", "Audio must be WAV, MP3, FLAC or OGG with matching container bytes.");
  }
  if (ascii(4, "ftyp")) return "video/mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video/webm";
  throw new ClassifierError("input", "Video must be MP4 or WebM with matching container bytes.");
}

async function loadMediaFile(
  path: string,
  cwd: string,
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<Buffer> {
  cancelled(signal);
  try {
    if (/^[a-z]+:/i.test(path)) throw new Error();
    const root = await realpath(cwd);
    const target = resolve(root, path);
    const inside = relative(root, target);
    if (!inside || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) throw new Error();
    let current = root;
    for (const part of inside.split(sep)) {
      cancelled(signal);
      current = resolve(current, part);
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || (current === target ? !entry.isFile() : !entry.isDirectory())) throw new Error();
    }
    if (await realpath(target) !== target) throw new Error();
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      await verifyOpenedPath(file.fd, root, signal);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error();
      const buffer = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        cancelled(signal);
        const read = await file.read(buffer, offset, buffer.length - offset, null);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset > maxBytes) throw new Error();
      return buffer.subarray(0, offset);
    } finally {
      await file.close();
    }
  } catch (error) {
    cancelled(signal);
    if (error instanceof ClassifierError) throw error;
    throw new ClassifierError("input", "Media must be a regular file inside cwd without symlinks, within the provider's documented byte limit.");
  }
}

async function prepareMedia(
  sources: NonNullable<ClassifyParams["media"]>,
  route: ResolvedModel,
  cwd: string,
  signal?: AbortSignal,
): Promise<PreparedMedia[]> {
  const audio = sources.filter((source) => source.type === "audio");
  const video = sources.filter((source) => source.type === "video");
  if (audio.length && !route.audio)
    throw new ClassifierError("capability", "The selected route does not support audio input.");
  if (video.length && !route.video)
    throw new ClassifierError("capability", "The selected route does not support video input.");
  if (audio.length > (route.api === "liquid-system-one" ? 8 : 4))
    throw new ClassifierError("input", "The selected route accepts at most " + (route.api === "liquid-system-one" ? 8 : 4) + " audio clips.");
  if (video.length > 2)
    throw new ClassifierError("input", "Clef-omni accepts at most two videos.");
  const result: PreparedMedia[] = [];
  for (const source of [...audio, ...video]) {
    const maxBytes = source.type === "video" ? 16 * 1024 * 1024 : route.api === "cloudflare-system-one" ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
    const bytes = await loadMediaFile(source.path, cwd, signal, maxBytes);
    result.push({
      type: source.type,
      mimeType: mediaMime(bytes, source.type),
      data: bytes.toString("base64"),
    });
  }
  return result;
}

export type PreparedExtractionInput = {
  state: string | Record<string, unknown> | unknown[];
  fields: NonNullable<ExtractParams["fields"]>;
  images: PreparedLocalImage[];
  documents: { mimeType: "application/pdf"; data: string }[];
  referenceDate?: string;
  options?: ExtractParams["options"];
};

const EXTRACTION_TYPES = new Set([
  "text", "number", "compute", "date", "time", "datetime", "duration",
  "boolean", "enum", "object", "list", "estimate", "forecast",
]);

function validateExtractionFields(value: unknown): NonNullable<ExtractParams["fields"]> {
  if (!isRecord(value) || Object.keys(value).length === 0)
    throw new ClassifierError("input", "fields must be a non-empty map of named field specifications.");
  for (const [name, field] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name) || !isRecord(field) || typeof field.type !== "string" || !EXTRACTION_TYPES.has(field.type))
      throw new ClassifierError("input", "Each field needs a provider field name and a documented Clairic type.");
    if (field.properties !== undefined) validateExtractionFields(field.properties);
    if (field.items !== undefined && isRecord(field.items) && field.items.properties !== undefined)
      validateExtractionFields(field.items.properties);
  }
  return value as NonNullable<ExtractParams["fields"]>;
}

async function loadDocumentFile(
  path: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  cancelled(signal);
  try {
    if (/^[a-z]+:/i.test(path)) throw new Error();
    const root = await realpath(cwd);
    const target = resolve(root, path);
    const inside = relative(root, target);
    if (!inside || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) throw new Error();
    let current = root;
    for (const part of inside.split(sep)) {
      cancelled(signal);
      current = resolve(current, part);
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || (current === target ? !entry.isFile() : !entry.isDirectory())) throw new Error();
    }
    if (await realpath(target) !== target) throw new Error();
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      await verifyOpenedPath(file.fd, root, signal);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 5 || stat.size > 4 * 1024 * 1024) throw new Error();
      const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
      let offset = 0;
      while (offset < buffer.length) {
        cancelled(signal);
        const read = await file.read(buffer, offset, buffer.length - offset, null);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset > 4 * 1024 * 1024 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error();
      return buffer.subarray(0, offset);
    } finally {
      await file.close();
    }
  } catch (error) {
    cancelled(signal);
    if (error instanceof ClassifierError) throw error;
    throw new ClassifierError("input", "Documents must be unencrypted PDF regular files inside cwd without symlinks, within 4 MiB.");
  }
}

export async function prepareExtractionInput(
  params: ExtractParams,
  route: ResolvedModel,
  cwd: string,
  signal?: AbortSignal,
): Promise<PreparedExtractionInput> {
  if (route.api !== "cloudflare-clairic")
    throw new ClassifierError("capability", "Clairic extraction requires the clairic-api route.");
  if (params.state !== undefined &&
      !(typeof params.state === "string" || Array.isArray(params.state) || isRecord(params.state)))
    throw new ClassifierError("input", "state must be text, a JSON object or an array.");
  const fields = validateExtractionFields(params.fields);
  if (params.referenceDate !== undefined &&
      (typeof params.referenceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(params.referenceDate)))
    throw new ClassifierError("input", "referenceDate must use YYYY-MM-DD.");
  if (params.options !== undefined) {
    if (!isRecord(params.options) ||
        Object.keys(params.options).some((key) => !["includeQuantiles", "returnStateText"].includes(key)) ||
        Object.values(params.options).some((value) => typeof value !== "boolean"))
      throw new ClassifierError("input", "options may only set includeQuantiles and returnStateText to booleans.");
  }
  if (params.images !== undefined && (!Array.isArray(params.images) || params.images.some((image) => typeof image !== "string" || !image.trim() || image.length > 4096)))
    throw new ClassifierError("input", "images must be local path strings inside cwd.");
  if (params.documents !== undefined && (!Array.isArray(params.documents) || params.documents.some((document) => typeof document !== "string" || !document.trim() || document.length > 4096)))
    throw new ClassifierError("input", "documents must be local PDF path strings inside cwd.");
  const images = await Promise.all((params.images ?? []).map((image) => loadLocalImage(image, cwd, signal, 4 * 1024 * 1024)));
  const documents = await Promise.all((params.documents ?? []).map(async (document) => ({
    mimeType: "application/pdf" as const,
    data: (await loadDocumentFile(document, cwd, signal)).toString("base64"),
  })));
  if (images.length > 4 || documents.length > 4 || images.length + documents.length > 4)
    throw new ClassifierError("input", "Clairic accepts at most four rendered images and PDF pages combined.");
  let bytes = 0;
  for (const media of [...images.map((image) => Buffer.from(image.data, "base64")), ...documents.map((document) => Buffer.from(document.data, "base64"))]) {
    bytes += media.byteLength;
    if (bytes > 8 * 1024 * 1024)
      throw new ClassifierError("input", "Clairic media exceeds the provider's 8 MiB combined decoded limit.");
  }
  if ((params.state === undefined || params.state === "") && images.length === 0 && documents.length === 0)
    throw new ClassifierError("input", "Clairic requires a non-empty state or media input.");
  return {
    state: params.state ?? "",
    fields,
    images,
    documents,
    ...(params.referenceDate !== undefined ? { referenceDate: params.referenceDate } : {}),
    ...(params.options !== undefined ? { options: params.options } : {}),
  };
}
