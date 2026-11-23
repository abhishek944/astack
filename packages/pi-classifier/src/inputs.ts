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
import { imageReferences, isImageReference } from "./image-content.js";
import { openRouterDecisionCapabilities, openRouterExtractionCapabilities } from "./config.js";

function topLevelImagePartsOnly(value: unknown): boolean {
  if (isImageReference(value)) return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" || isImageReference(entry));
}

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
  const questionCount = Object.keys(params.questions).length;
  if (questionCount > route.limits.maxQuestions)
    throw new ClassifierError(
      "input",
      "The selected route accepts at most " + route.limits.maxQuestions + " questions in this package.",
    );
  if (route.api === "perplexity-decisions" && params.mode === "web_grounding" && questionCount > 100)
    throw new ClassifierError("input", "Perplexity web grounding accepts at most 100 questions.");
  const openRouter = route.api === "openrouter-decisions" ? openRouterDecisionCapabilities(route.model) : undefined;
  const imageCount = (params.images?.length ?? 0) + memoryImages.length;
  if (imageCount && !route.images)
    throw new ClassifierError("capability", "The selected model does not support images, or experimental Jev images are disabled.");
  if (hasBox(params.questions) && (!route.box || !imageCount))
    throw new ClassifierError("capability", "box requires an enabled Jev 1.14 model, experimentalImages/experimentalBox and an image.");
  if (params.mode === "web_grounding" && route.api !== "perplexity-decisions")
    throw new ClassifierError("capability", "Web grounding is supported only by Perplexity Decisions routes.");
  if (route.api === "cloudflare-clairic")
    throw new ClassifierError("capability", "Clairic extraction uses classify_extract with fields, not classify questions.");
  if (params.imageDetail !== undefined && !["openai-decisions", "openrouter-decisions"].includes(route.api))
    throw new ClassifierError("capability", "imageDetail is supported only by OpenAI-compatible and OpenRouter Decisions routes.");
  if (params.promptCache !== undefined && route.api !== "openai-decisions")
    throw new ClassifierError("capability", "promptCache is supported only by the OpenAI Decisions wire contract.");
  if (params.conversation !== undefined && route.api !== "openai-decisions")
    throw new ClassifierError("capability", "conversation input is supported only by the OpenAI Decisions wire contract.");
  const liquidQuestions = ["bool", "choice", "score", "text", "number", "date", "spans", "boxes", "estimate", "multi_choice", "box"];
  const decisionQuestions = ["bool", "choice", "score", "box", "locate"];
  const coreQuestions = ["bool", "choice", "score"];
  const sarvamQuestions = ["bool", "choice", "score"];
  const openRouterQuestions = route.box
    ? ["bool", "choice", "score", "box"]
    : ["bool", "choice", "score"];
  const allowed =
    route.api === "liquid-system-one"
      ? liquidQuestions
      : route.api === "sarvam-system-one"
        ? sarvamQuestions
        : route.api === "inception-decisions"
          ? [...coreQuestions, "extract"]
          : ["gemini-decisions", "parallel-decisions", "local-system-one"].includes(route.api)
            ? coreQuestions
            : openRouter
              ? openRouterQuestions
              : decisionQuestions;
  const unsupported = Object.values(params.questions).find((question) => !allowed.includes(question.type));
  if (unsupported)
    throw new ClassifierError("capability", "The selected route does not support " + unsupported.type + " questions.");
  const extracts = Object.values(params.questions).filter((question) => question.type === "extract");
  if (extracts.length > 0 && route.api !== "inception-decisions")
    throw new ClassifierError("capability", "extract questions are supported only by Inception Mercury Decide.");
  if (extracts.length > 0) {
    if (imageCount > 0 || (params.media?.length ?? 0) > 0)
      throw new ClassifierError("input", "Inception extract questions cannot be combined with images or media.");
    if (typeof params.state !== "string") {
      if (!isRecord(params.state) && !Array.isArray(params.state))
        throw new ClassifierError("input", "Inception extract questions require text or JSON state.");
      for (const question of extracts) {
        if (typeof question.source !== "string" || !question.source.trim())
          throw new ClassifierError("input", "Inception extract questions require source when state is JSON.");
        const value = (params.state as Record<string, unknown>)[question.source];
        if (typeof value !== "string")
          throw new ClassifierError("input", "Inception extract source must name a string field in the JSON state.");
      }
    }
  }
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
  if (imageCount > route.limits.maxImages)
    throw new ClassifierError("input", "The selected route accepts at most " + route.limits.maxImages + " images in this package.");
  const flexibleReferences = openRouter?.flexibleImagePlacement === true;
  if (imageReferences(params.state).length && !flexibleReferences && !["system-one", "openai-decisions", "perplexity-decisions", "microsoft-system-one", "gemini-decisions", "inception-decisions", "openrouter-decisions"].includes(route.api))
    throw new ClassifierError("capability", "This route does not support explicit image references in state; use shared image parts instead.");
  if (
    route.api === "openrouter-decisions" &&
    !flexibleReferences &&
    imageReferences(params.state).length > 0 &&
    !topLevelImagePartsOnly(params.state)
  )
    throw new ClassifierError("capability", "OpenRouter adapters other than TypeSafe and Microsoft read images only as top-level state parts. Put each {$image:id} directly in a state array, not inside an object or another array.");
  for (const question of Object.values(params.questions)) {
    if (imageReferences(question.instructions).length && !flexibleReferences && !["system-one", "openai-decisions", "microsoft-system-one", "inception-decisions"].includes(route.api))
      throw new ClassifierError("capability", "Image references in question instructions require Jev, OpenAI Decisions or a flexible OpenRouter Decisions endpoint.");
    if (question.type !== "extract" && "criteria" in question && question.criteria && Object.values(question.criteria).some((entry) => imageReferences(entry).length) && route.api !== "system-one" && route.api !== "microsoft-system-one" && !flexibleReferences)
      throw new ClassifierError("capability", "Image references in criteria require a Jev assets-protocol route or a flexible OpenRouter Decisions endpoint.");
  }
  // Reject unsupported URL placement before opening any local files.
  for (const source of params.images ?? []) {
    if (typeof source !== "string" && "url" in source) {
      if (route.api !== "openai-decisions" && openRouter?.remoteImageUrls !== true)
        throw new ClassifierError("capability", "Hosted image URLs are supported only by OpenAI Decisions and documented OpenRouter Decisions endpoints. No URL was fetched.");
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
    if (route.api === "microsoft-system-one" && image.mimeType === "image/webp")
      throw new ClassifierError("input", "Microsoft Foundry Decision-1.1 image assets accept PNG and JPEG only.");
    if (route.api === "system-one") {
      if (image.mimeType === "image/webp")
        throw new ClassifierError("input", "Jev image assets accept PNG and JPEG only.");
      const pixels = image.width * image.height;
      if (image.width < 280 || image.width > 1568 || image.height < 280 || image.height > 1568 || pixels < 78_400 || pixels > 2_458_624)
        throw new ClassifierError("input", "Resize or pad Jev images before sending: each side must be 280–1568 pixels and total area 78400–2458624 pixels. Images are not silently resized.");
    }
    if (openRouter?.flexibleImagePlacement) {
      if (image.mimeType === "image/webp")
        throw new ClassifierError("input", "OpenRouter TypeSafe and Microsoft Decisions endpoints accept PNG and JPEG only.");
      const minimum = /typesafe\/jev/.test(route.model) ? 256 : 280;
      if (image.width < minimum || image.width > 1568 || image.height < minimum || image.height > 1568 ||
          image.width * image.height < minimum * minimum || image.width * image.height > 2_458_624)
        throw new ClassifierError("input", "Resize or pad this OpenRouter Decisions image: each side must be " + minimum + "–1568 pixels and the area must stay within the endpoint's documented range.");
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
    ...(params.conversation !== undefined ? { conversation: params.conversation } : {}),
    ...(params.imageDetail !== undefined ? { imageDetail: params.imageDetail } : {}),
    ...(params.promptCache !== undefined ? { promptCache: params.promptCache } : {}),
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
  if (audio.length > route.limits.maxAudio)
    throw new ClassifierError("input", "The selected route accepts at most " + route.limits.maxAudio + " audio clips.");
  if (video.length > route.limits.maxVideo)
    throw new ClassifierError("input", "The selected route accepts at most " + route.limits.maxVideo + " videos.");
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

export type PreparedExtractionImage = PreparedLocalImage & { rotation?: 0 | 90 | 180 | 270 };

export type PreparedExtractionInput = {
  state: string | Record<string, unknown> | unknown[];
  fields: NonNullable<ExtractParams["fields"]>;
  images: PreparedExtractionImage[];
  documents: { mimeType: "application/pdf"; data: string }[];
  referenceDate?: string;
  options?: ExtractParams["options"];
};

const EXTRACTION_TYPES = new Set([
  "text", "number", "compute", "date", "time", "datetime", "duration",
  "boolean", "enum", "object", "list", "estimate", "forecast",
]);

const OPENROUTER_EXTRACTION_FIELD_KEYS: Record<string, { allowed: string[]; required: string[] }> = {
  text: { allowed: ["type", "instructions", "null_threshold", "unit"], required: ["type"] },
  number: { allowed: ["type", "decimals", "instructions", "integer", "null_threshold", "unit"], required: ["type"] },
  date: { allowed: ["type", "instructions", "null_threshold", "unit"], required: ["type"] },
  time: { allowed: ["type", "instructions", "null_threshold", "unit"], required: ["type"] },
  datetime: { allowed: ["type", "instructions", "null_threshold", "unit"], required: ["type"] },
  duration: { allowed: ["type", "decimals", "instructions", "integer", "null_threshold", "unit"], required: ["type"] },
  list: { allowed: ["type", "decimals", "instructions", "integer", "items", "null_threshold", "unit"], required: ["type", "items"] },
  estimate: { allowed: ["type", "instructions", "max", "min", "scale", "step", "unit"], required: ["type", "min", "max"] },
  forecast: { allowed: ["type", "horizon", "instructions", "interval", "max", "min", "scale", "step", "unit"], required: ["type", "min", "max", "horizon", "interval"] },
};

function validateOpenRouterExtractionFields(
  fields: NonNullable<ExtractParams["fields"]>,
  model: string,
): void {
  const isClairic = model === "cloudflare/clairic";
  const isLiquid = /^liquid\/d1\.2/.test(model);
  const isScaleDown = model === "scaledown/extract";
  const textItemsOnly = isScaleDown || isLiquid || model.startsWith("inception/") || model.startsWith("perplexity/");
  const noNullThreshold = isScaleDown || model.startsWith("perplexity/") || model.startsWith("inference-net/");
  for (const [name, field] of Object.entries(fields)) {
    if (!isRecord(field) || typeof field.type !== "string")
      throw new ClassifierError("input", "Each extraction field needs a type.");
    const schema = OPENROUTER_EXTRACTION_FIELD_KEYS[field.type];
    if (!schema)
      throw new ClassifierError("input", "OpenRouter extraction does not support field type " + field.type + ".");
    const keys = Object.keys(field);
    const unknown = keys.filter((key) => !schema.allowed.includes(key));
    if (unknown.length > 0)
      throw new ClassifierError("input", "Field " + name + " uses keys OpenRouter does not accept: " + unknown.join(", ") + ".");
    const missing = schema.required.filter((key) => !Object.hasOwn(field, key));
    if (missing.length > 0)
      throw new ClassifierError("input", "Field " + name + " is missing required OpenRouter keys: " + missing.join(", ") + ".");
    if (field.null_threshold !== undefined) {
      const threshold = field.null_threshold;
      if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        throw new ClassifierError("input", "Field " + name + " has an invalid null_threshold.");
      if (noNullThreshold || (isClairic && ["list", "estimate", "forecast"].includes(field.type)) || (isLiquid && field.type === "list"))
        throw new ClassifierError("capability", "The selected extraction model does not accept null_threshold on this field.");
      if (isClairic && threshold === 0)
        throw new ClassifierError("input", "Clairic requires null_threshold above zero.");
      if (isLiquid && ["text", "number", "date"].includes(field.type) && threshold <= 0)
        throw new ClassifierError("input", "Liquid extraction requires null_threshold above zero on text, number and date fields.");
    } else if (isLiquid && ["text", "number", "date"].includes(field.type)) {
      throw new ClassifierError("input", "Liquid extraction requires null_threshold above zero on text, number and date fields.");
    }
    if (field.unit !== undefined && !isClairic && !(isLiquid && field.type === "estimate"))
      throw new ClassifierError("capability", "The selected extraction model does not accept unit on this field.");
    if (field.type === "list") {
      if (typeof field.items !== "string" || !["text", "number", "date"].includes(field.items))
        throw new ClassifierError("input", "OpenRouter list fields require items of text, number or date.");
      if (textItemsOnly && field.items !== "text")
        throw new ClassifierError("capability", "The selected extraction model supports only text list items.");
      if (isLiquid && (field.unit !== undefined || field.integer !== undefined || field.decimals !== undefined))
        throw new ClassifierError("capability", "Liquid list fields accept only items: text.");
    }
    if (field.type === "estimate" && isLiquid) {
      if ((typeof field.min !== "number" || !Number.isFinite(field.min)) ||
          (typeof field.max !== "number" || !Number.isFinite(field.max)) ||
          (field.step !== undefined && typeof field.step !== "number"))
        throw new ClassifierError("input", "Liquid estimate fields require numeric min, max and optional numeric step.");
      if (field.scale !== undefined && field.scale !== "linear")
        throw new ClassifierError("capability", "Liquid extraction accepts only linear estimates.");
    }
  }
}

function validateExtractionFields(
  value: unknown,
  allowedTypes: ReadonlySet<string> = EXTRACTION_TYPES,
  maxFields = 128,
): NonNullable<ExtractParams["fields"]> {
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).length > maxFields)
    throw new ClassifierError("input", "fields must be a non-empty map of at most " + maxFields + " named field specifications.");
  for (const [name, field] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name) || !isRecord(field) || typeof field.type !== "string" || !allowedTypes.has(field.type))
      throw new ClassifierError("input", "Each field needs a provider field name and a documented type for the selected extraction model.");
    if (field.properties !== undefined) validateExtractionFields(field.properties, allowedTypes, maxFields);
    if (field.items !== undefined && isRecord(field.items) && field.items.properties !== undefined)
      validateExtractionFields(field.items.properties, allowedTypes, maxFields);
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
  if (!["cloudflare-clairic", "openrouter-extractions", "litellm-extraction"].includes(route.api))
    throw new ClassifierError("capability", "Extraction requires a clairic-api, openrouter-extractions-api or litellm-extraction-api route.");
  if (params.state !== undefined &&
      !(typeof params.state === "string" || Array.isArray(params.state) || isRecord(params.state)))
    throw new ClassifierError("input", "state must be text, a JSON object or an array.");
  const extractionCaps = route.api === "openrouter-extractions" ? openRouterExtractionCapabilities(route.model) : undefined;
  const fields = validateExtractionFields(
    params.fields,
    extractionCaps ? new Set(extractionCaps.fieldTypes) : EXTRACTION_TYPES,
    extractionCaps?.maxFields,
  );
  if (route.api === "openrouter-extractions")
    validateOpenRouterExtractionFields(fields, route.model);
  if (extractionCaps?.referenceDate === false && params.referenceDate !== undefined)
    throw new ClassifierError("capability", "The selected extraction model does not accept referenceDate.");
  if (params.referenceDate !== undefined &&
      (typeof params.referenceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(params.referenceDate)))
    throw new ClassifierError("input", "referenceDate must use YYYY-MM-DD.");
  if (params.options !== undefined) {
    if (!isRecord(params.options) ||
        Object.keys(params.options).some((key) => !["includeQuantiles", "returnStateText"].includes(key)) ||
        Object.values(params.options).some((value) => typeof value !== "boolean"))
      throw new ClassifierError("input", "options may only set includeQuantiles and returnStateText to booleans.");
  }
  if (params.images !== undefined && (!Array.isArray(params.images) || params.images.some((image) =>
    typeof image === "string"
      ? !image.trim() || image.length > 4096
      : !isRecord(image) || Object.keys(image).some((key) => key !== "path" && key !== "rotation") ||
        typeof image.path !== "string" || !image.path.trim() || image.path.length > 4096 ||
        (image.rotation !== undefined && ![0, 90, 180, 270].includes(image.rotation as number)))))
    throw new ClassifierError("input", "images must be local path strings or {path, rotation} objects with rotation 0, 90, 180 or 270.");
  if (route.api !== "cloudflare-clairic" && (params.images ?? []).some((image) => typeof image !== "string" && image.rotation !== undefined))
    throw new ClassifierError("capability", "Image rotation is documented only for direct Cloudflare Clairic.");
  if (params.documents !== undefined && (!Array.isArray(params.documents) || params.documents.some((document) => typeof document !== "string" || !document.trim() || document.length > 4096)))
    throw new ClassifierError("input", "documents must be local PDF path strings inside cwd.");
  const maxDocuments = route.api === "cloudflare-clairic"
    ? 4
    : route.api === "openrouter-extractions"
      ? extractionCaps?.maxDocuments ?? 0
      : 0;
  if ((params.documents?.length ?? 0) > maxDocuments)
    throw new ClassifierError("capability", "The selected extraction route accepts at most " + maxDocuments + " PDF documents.");
  const isScaleDown = route.api === "openrouter-extractions" && route.model === "scaledown/extract";
  if (isScaleDown && (params.images?.length ?? 0) + (params.documents?.length ?? 0) > 0 && params.state !== undefined && params.state !== "")
    throw new ClassifierError("input", "ScaleDown Extract reads either text state or one asset, not both. Omit state when sending a PDF or image.");
  const images = await Promise.all((params.images ?? []).map(async (image) => {
    const spec = typeof image === "string" ? { path: image } : image;
    const loaded = await loadLocalImage(spec.path, cwd, signal, 4 * 1024 * 1024);
    return spec.rotation === undefined ? loaded : { ...loaded, rotation: spec.rotation as 0 | 90 | 180 | 270 };
  }));
  const documents = await Promise.all((params.documents ?? []).map(async (document) => ({
    mimeType: "application/pdf" as const,
    data: (await loadDocumentFile(document, cwd, signal)).toString("base64"),
  })));
  if (route.api === "openrouter-extractions" && /^liquid\/d1\.2/.test(route.model) && images.length > 0 &&
      Object.values(fields).some((field) => isRecord(field) && field.type !== "estimate"))
    throw new ClassifierError("capability", "OpenRouter Liquid extraction models read images only for estimate fields.");
  if (isScaleDown && images.some((image) => image.mimeType === "image/webp"))
    throw new ClassifierError("capability", "ScaleDown Extract does not read WebP images.");
  if (images.length > route.limits.maxImages)
    throw new ClassifierError("input", "The selected extraction model accepts at most " + route.limits.maxImages + " images.");
  const maxAssets = route.api === "cloudflare-clairic"
    ? 4
    : extractionCaps?.maxAssets ?? route.limits.maxImages;
  if (images.length + documents.length > maxAssets)
    throw new ClassifierError("input", "The selected extraction model accepts at most " + maxAssets + " media assets in total.");
  if (route.api === "cloudflare-clairic" && images.length + documents.length > 4)
    throw new ClassifierError("input", "Direct Clairic accepts at most four rendered images and PDF pages combined.");
  let bytes = 0;
  for (const media of [...images.map((image) => Buffer.from(image.data, "base64")), ...documents.map((document) => Buffer.from(document.data, "base64"))]) {
    bytes += media.byteLength;
    if (bytes > 8 * 1024 * 1024)
      throw new ClassifierError("input", "Extraction media exceeds the provider's 8 MiB combined decoded limit.");
  }
  if ((params.state === undefined || params.state === "") && images.length === 0 && documents.length === 0)
    throw new ClassifierError("input", "Extraction requires a non-empty state or media input.");
  return {
    state: params.state ?? "",
    fields,
    images,
    documents,
    ...(params.referenceDate !== undefined ? { referenceDate: params.referenceDate } : {}),
    ...(params.options !== undefined ? { options: params.options } : {}),
  };
}
