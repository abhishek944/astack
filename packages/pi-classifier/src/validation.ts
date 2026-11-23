import {
  ClassifierError,
  isRecord,
  type ClassifyParams,
  type Question,
} from "./types.js";
import { imageReferences, isImageReference, questionImageReferences } from "./image-content.js";

function invalid(message: string): never {
  throw new ClassifierError("input", message);
}
const imageId = /^[a-zA-Z0-9_-]{1,64}$/;

function content(value: unknown, maxLength: number, nonempty = false): boolean {
  if (typeof value === "string") return value.length <= maxLength && (!nonempty || Boolean(value.trim()));
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) return false;
  if (!value.every((part) => typeof part === "string" || isImageReference(part))) return false;
  validateJson(value, 0);
  return Buffer.byteLength(JSON.stringify(value)) <= maxLength &&
    (!nonempty || value.some((part) => typeof part !== "string" || Boolean(part.trim())));
}

export function validateParams(value: unknown): ClassifyParams {
  if (!isRecord(value) || Object.keys(value).some((key) => !["state", "questions", "images", "media", "mode", "conversation", "imageDetail", "promptCache"].includes(key)))
    invalid("Expected state, questions and optional images, media, mode, conversation, imageDetail or promptCache; provider/model are selected in settings.");
  if (!(typeof value.state === "string" || Array.isArray(value.state) || isRecord(value.state)))
    invalid("state must be text, a JSON object or an array.");
  validateJson(value.state, 0);
  if (!isRecord(value.questions)) invalid("questions must be a map keyed by question ID.");
  const entries = Object.entries(value.questions);
  if (entries.length < 1 || entries.length > 1000) invalid("Supply between 1 and 1000 questions; the selected route enforces its own lower limit.");
  for (const [id, question] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !isRecord(question))
      invalid("Question IDs must be 1–64 letters, digits, underscores or hyphens.");
    const allowed = question.type === "number" || question.type === "estimate"
      ? ["type", "instructions", "unit", "range", "step"]
      : question.type === "spans" || question.type === "boxes"
        ? ["type", "instructions", "max"]
        : question.type === "choice"
          ? ["type", "instructions", "criteria", "booleanValues"]
          : question.type === "score"
            ? ["type", "instructions", "criteria", "descriptions"]
            : question.type === "extract"
              ? ["type", "instructions", "criteria", "source", "threshold", "snapToWords", "debug"]
              : ["type", "instructions", "criteria"];
    if (Object.keys(question).some((key) => !allowed.includes(key)))
      invalid("Unknown question field for " + String(question.type) + ".");
    if (question.type !== "extract" && !content(question.instructions, 16_384, true))
      invalid("Each question needs non-empty text or ordered text/image-reference instructions, at most 16384 characters/bytes.");
    if (question.type === "extract" && question.instructions !== undefined && !content(question.instructions, 16_384))
      invalid("Extract instructions must be text or ordered text/image-reference content, at most 16384 characters/bytes.");
    if (question.type === "bool") {
      if (question.criteria !== undefined && (!isRecord(question.criteria) ||
        Object.entries(question.criteria).some(([key, entry]) => !["true", "false"].includes(key) || !content(entry, 4096))))
        invalid("bool criteria must contain optional true/false descriptions or image content.");
    } else if (question.type === "choice") {
      if (!isRecord(question.criteria)) invalid("choice criteria must map labels to descriptions.");
      const criteria = Object.entries(question.criteria);
      if (criteria.length < 1 || criteria.some(([key, entry]) => !key.trim() || key.length > 128 || !content(entry, 4096)))
        invalid("choice requires at least one label with a text or image-content description.");
      if (question.booleanValues !== undefined) {
        if (typeof question.booleanValues !== "boolean")
          invalid("choice.booleanValues must be a boolean.");
        if (question.booleanValues && criteria.some(([key]) => key !== "true" && key !== "false"))
          invalid("Boolean-valued choices must use the labels true and false.");
      }
    } else if (question.type === "score") {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10 ||
        question.criteria.some((entry) => !content(entry, 4096, true)))
        invalid("score criteria must contain 2–10 non-empty ordered descriptions or image content.");
      if (question.descriptions !== undefined &&
          (!Array.isArray(question.descriptions) || question.descriptions.length !== question.criteria.length ||
           question.descriptions.some((entry) => typeof entry !== "string" || entry.length > 4096)))
        invalid("score descriptions must contain one string per criterion, at most 4096 characters each.");
    } else if (question.type === "box") {
      if (question.criteria !== undefined) invalid("box does not accept criteria.");
    } else if (question.type === "locate" || question.type === "text" || question.type === "date") {
      if (question.criteria !== undefined) invalid(question.type + " does not accept criteria.");
    } else if (question.type === "spans" || question.type === "boxes") {
      if (question.criteria !== undefined) invalid(question.type + " does not accept criteria.");
      if (question.max !== undefined &&
          (!Number.isSafeInteger(question.max) || (question.max as number) < 1 || (question.max as number) > 64))
        invalid(question.type + ".max must be an integer from 1 to 64.");
    } else if (question.type === "number" || question.type === "estimate") {
      if (question.unit !== undefined && (typeof question.unit !== "string" || question.unit.length > 128))
        invalid("unit must be a string of at most 128 characters.");
      if (question.step !== undefined && (typeof question.step !== "number" || !Number.isFinite(question.step) || question.step <= 0))
        invalid("step must be a positive finite number.");
      const range = question.range;
      if (question.type === "estimate" && !Array.isArray(range))
        invalid("estimate requires a [low, high] range.");
      if (range !== undefined && (!Array.isArray(range) || range.length !== 2 ||
        range.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)) ||
        (range[0] as number) >= (range[1] as number)))
        invalid("range must be a finite [low, high] pair with low below high.");
    } else if (question.type === "extract") {
      if (!isRecord(question.criteria))
        invalid("extract criteria must map field names to descriptions.");
      const criteria = Object.entries(question.criteria);
      if (criteria.length < 1 || criteria.length > 26 || criteria.some(([key, entry]) => !key.trim() || key.length > 128 || !content(entry, 4096)))
        invalid("extract requires 1–26 fields with text descriptions.");
      if (question.source !== undefined && (typeof question.source !== "string" || !question.source.trim() || question.source.length > 4096))
        invalid("extract.source must be a non-empty string of at most 4096 characters.");
      if (question.threshold !== undefined && (typeof question.threshold !== "number" || !Number.isFinite(question.threshold) || question.threshold < 0 || question.threshold > 1))
        invalid("extract.threshold must be a number between 0 and 1.");
      if (question.snapToWords !== undefined && typeof question.snapToWords !== "boolean")
        invalid("extract.snapToWords must be a boolean.");
      if (question.debug !== undefined && typeof question.debug !== "boolean")
        invalid("extract.debug must be a boolean.");
    } else if (question.type === "multi_choice") {
      if (!isRecord(question.criteria))
        invalid("multi_choice criteria must map labels to descriptions.");
      const criteria = Object.entries(question.criteria);
      if (criteria.length < 2 || criteria.some(([key, entry]) => !key.trim() || key.length > 128 || !content(entry, 4096)))
        invalid("multi_choice requires at least two labels with text or image-content descriptions.");
    } else invalid("Question type must be a supported typed decision or read.");
  }
  if (value.media !== undefined) {
    if (!Array.isArray(value.media))
      invalid("media must be an array of audio/video descriptors.");
    for (const item of value.media) {
      if (!isRecord(item) || (item.type !== "audio" && item.type !== "video") ||
          Object.keys(item).some((key) => key !== "type" && key !== "path") ||
          typeof item.path !== "string" || !item.path.trim() || item.path.length > 4096)
        invalid("Each media descriptor needs a type of audio or video and a local path.");
    }
  }
  if (value.conversation !== undefined) {
    if (!Array.isArray(value.conversation))
      invalid("conversation must be an array of OpenAI Decisions input items.");
    const types = ["message", "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output"];
    for (const item of value.conversation) {
      if (!isRecord(item) || typeof item.type !== "string" || !types.includes(item.type))
        invalid("Each conversation item needs a documented OpenAI Decisions input type.");
    }
  }
  if (value.mode !== undefined && value.mode !== "web_grounding")
    invalid("mode must be omitted or \"web_grounding\".");
  if (value.imageDetail !== undefined &&
      (typeof value.imageDetail !== "string" || !["auto", "low", "high", "original"].includes(value.imageDetail)))
    invalid("imageDetail must be auto, low, high or original.");
  if (value.promptCache !== undefined) {
    if (!isRecord(value.promptCache) ||
        Object.keys(value.promptCache).some((key) => !["key", "mode", "ttl", "breakpoints"].includes(key)))
      invalid("promptCache may only set key, mode, ttl and breakpoints.");
    if (value.promptCache.key !== undefined &&
        (typeof value.promptCache.key !== "string" || value.promptCache.key.length < 1 || value.promptCache.key.length > 64))
      invalid("promptCache.key must be 1–64 characters.");
    if (value.promptCache.mode !== undefined &&
        (typeof value.promptCache.mode !== "string" || !["implicit", "explicit"].includes(value.promptCache.mode)))
      invalid("promptCache.mode must be implicit or explicit.");
    if (value.promptCache.ttl !== undefined && value.promptCache.ttl !== "30m")
      invalid("promptCache.ttl may only be 30m.");
    if (value.promptCache.breakpoints !== undefined && typeof value.promptCache.breakpoints !== "boolean")
      invalid("promptCache.breakpoints must be a boolean.");
  }
  const ids = new Set<string>();
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length > 128)
      invalid("images must contain at most 128 local paths or named path/url descriptors; route-specific limits also apply.");
    for (const image of value.images) {
      if (typeof image === "string") {
        if (!image.trim() || image.length > 4096) invalid("Image paths must be non-empty, at most 4096 characters.");
        continue;
      }
      if (!isRecord(image) || typeof image.id !== "string" || !imageId.test(image.id) ||
        Object.keys(image).some((key) => !["id", "path", "url"].includes(key)) ||
        (Object.hasOwn(image, "path") === Object.hasOwn(image, "url")))
        invalid("Named images require a unique id and exactly one path or url.");
      const source = image.path ?? image.url;
      if (typeof source !== "string" || !source.trim() || source.length > 4096)
        invalid("Image path/url must be non-empty, at most 4096 characters.");
      if (ids.has(image.id)) invalid("Named image IDs must be unique.");
      ids.add(image.id);
    }
  }
  const references = [...imageReferences(value.state), ...questionImageReferences(value.questions as Record<string, Question>)];
  for (const id of references) if (!ids.has(id)) invalid("Every image reference must name an image descriptor in images.");
  for (const id of ids) if (!references.includes(id)) invalid("Every named image must be referenced in state, instructions or criteria.");
  if (value.mode === "web_grounding" &&
      Object.values(value.questions).some((question) => isRecord(question) && question.type === "locate") &&
      typeof value.state !== "string")
    invalid("web grounding with locate requires a string state.");
  if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
    invalid("Classification text and questions must be at most 2 MiB.");
  return value as unknown as ClassifyParams;
}

function validateJson(value: unknown, depth: number): void {
  if (depth > 32) invalid("JSON content must be at most 32 levels deep.");
  if (isImageReference(value)) {
    if (Object.keys(value).length !== 1 || typeof value.$image !== "string" || !imageId.test(value.$image))
      invalid("An image reference must be exactly {$image: id} with a 1–64 character image ID.");
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateJson(entry, depth + 1);
    return;
  }
  if (isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    for (const entry of Object.values(value)) validateJson(entry, depth + 1);
    return;
  }
  invalid("Content must contain only finite JSON values.");
}

export function hasBox(questions: Record<string, Question>): boolean {
  return Object.values(questions).some((question) => question.type === "box");
}
