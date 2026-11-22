import { randomUUID } from "node:crypto";
import { imageContentParts, imageReferences, imageUrl, mapImageReferences, namedImage, questionImageReferences } from "./image-content.js";
import { postJson } from "./http.js";
import { estimateCost, tokenCount } from "./cost.js";
import {
  ClassifierError,
  isRecord,
  type Answer,
  type ClassifierResult,
  type QuestionContent,
  type PreparedInput,
  type PreparedMedia,
  type Question,
  type ResolvedModel,
  type TextSpan,
  type WebFetchedResult,
  type WebSearchResult,
} from "./types.js";

/**
 * Provider protocol adapters. Every request goes through the shared `postJson` boundary, which
 * owns timeouts, cancellation, bounded reads and safe errors. Each adapter call classifies once;
 * route orchestration belongs to classify.ts. Answers are rebuilt field by field from validated values, so raw provider
 * bodies and provider error text never reach callers.
 */

const OPENAI_LABEL = "OpenAI Decisions";
const PERPLEXITY_LABEL = "Perplexity Decisions";
const TYPESAFE_LABEL = "TypeSafe System One";
const CLOUDFLARE_LABEL = "Cloudflare Workers AI";
const EPSILON = 1e-6;
const DISTRIBUTION_TOLERANCE = 0.01;

export async function classifyWithProvider(
  route: ResolvedModel,
  input: PreparedInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ClassifierResult> {
  switch (route.api) {
    case "openai-decisions":
      return classifyOpenAi(route, input, apiKey, signal);
    case "perplexity-decisions":
      return classifyPerplexity(route, input, apiKey, signal);
    case "system-one":
      return classifySystemOne(route, input, apiKey, signal);
    case "liquid-system-one":
      return classifyLiquid(route, input, apiKey, signal);
    case "microsoft-system-one":
      return classifyMicrosoft(route, input, apiKey, signal);
    case "cloudflare-system-one":
      return classifyCloudflare(route, input, apiKey, signal);
    default:
      throw new ClassifierError(
        "configuration",
        "Unsupported classifier API protocol.",
      );
  }
}

/* Shared validation ------------------------------------------------------- */

function fail(message: string): never {
  throw new ClassifierError("response", message);
}

function unsupportedBox(): ClassifierError {
  return new ClassifierError(
    "capability",
    "The selected route does not support box questions. Box requires an experimental Jev 1.14 route with images enabled.",
  );
}

function probability(label: string, value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    fail(label + " returned an invalid " + field + ".");
  return value;
}

function unitInterval(label: string, value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < -EPSILON ||
    value > 1 + EPSILON
  ) {
    fail(label + " returned an invalid " + field + ".");
  }
  return Math.min(1, Math.max(0, value));
}

function normalizedUsage(
  value: unknown,
): ClassifierResult["usage"] | undefined {
  if (!isRecord(value)) return undefined;
  const input = tokenCount(value.input_tokens);
  const output = tokenCount(value.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  const total =
    tokenCount(value.total_tokens) ?? tokenCount((input ?? 0) + (output ?? 0));
  if (total === undefined) return undefined;
  const usage: NonNullable<ClassifierResult["usage"]> = {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    totalTokens: total,
  };
  if (isRecord(value.input_tokens_details)) {
    const cached = tokenCount(value.input_tokens_details.cached_tokens);
    const writes = tokenCount(value.input_tokens_details.cache_write_tokens);
    if (cached !== undefined) usage.cachedInputTokens = cached;
    if (writes !== undefined) usage.cacheWriteTokens = writes;
  }
  return usage;
}

function finish(
  route: ResolvedModel,
  answers: Record<string, Answer>,
  rawUsage: unknown,
  requestId: string | undefined,
): ClassifierResult {
  const result: ClassifierResult = {
    provider: route.route,
    model: route.model,
    answers,
    cost: estimateCost(route, rawUsage),
  };
  const usage = normalizedUsage(rawUsage);
  if (usage !== undefined) result.usage = usage;
  if (requestId !== undefined) result.requestId = requestId;
  return result;
}

function textContent(value: QuestionContent): string {
  if (typeof value === "string") return value;
  if (value.some((part) => typeof part !== "string"))
    throw new ClassifierError("capability", "This content placement does not support images on the selected route.");
  return value.join("");
}

function openAiContent(value: unknown, input: PreparedInput): unknown[] {
  return imageContentParts(value, (id) => ({ type: "input_image", image_url: imageUrl(namedImage(input.images, id)) }))
    .map((part) => typeof part === "string" ? { type: "input_text", text: part } : part);
}

/* Answer parsing for map-shaped answers (Perplexity, System One, Clef) --- */

function labelProbabilities(
  label: string,
  id: string,
  value: unknown,
  labels: string[],
): Record<string, number> {
  if (!isRecord(value))
    fail(label + " returned invalid probabilities for " + id + ".");
  const result = Object.create(null) as Record<string, number>;
  for (const [key, entry] of Object.entries(value)) {
    if (!labels.includes(key))
      fail(
        label +
          " returned an unknown option in the probabilities for " +
          id +
          ".",
      );
    result[key] = probability(
      label,
      entry,
      "probability for " + id + "." + key,
    );
  }
  for (const key of labels) {
    if (!Object.hasOwn(result, key))
      fail(label + " did not return a probability for " + id + "." + key + ".");
  }
  return checkDistribution(label, id, result);
}

/** Probability mass must be close to 1; it is never renormalized on the caller's behalf. */
function independentLabelProbabilities(
  label: string,
  id: string,
  value: unknown,
  labels: string[],
): Record<string, number> {
  if (!isRecord(value))
    fail(label + " returned invalid probabilities for " + id + ".");
  const result = Object.create(null) as Record<string, number>;
  for (const [key, entry] of Object.entries(value)) {
    if (!labels.includes(key))
      fail(
        label +
          " returned an unknown option in the probabilities for " +
          id +
          ".",
      );
    result[key] = probability(
      label,
      entry,
      "probability for " + id + "." + key,
    );
  }
  for (const key of labels) {
    if (!Object.hasOwn(result, key))
      fail(label + " did not return a probability for " + id + "." + key + ".");
  }
  // Liquid multi-select questions treat each label as its own yes/no decision.
  return result;
}

function checkDistribution(
  label: string,
  id: string,
  probabilities: Record<string, number>,
): Record<string, number> {
  let total = 0;
  for (const value of Object.values(probabilities)) total += value;
  if (Math.abs(total - 1) > DISTRIBUTION_TOLERANCE)
    fail(
      label + " returned probabilities that do not sum to 1 for " + id + ".",
    );
  return probabilities;
}

function levelProbabilities(
  label: string,
  id: string,
  value: unknown,
  levels: number,
): Record<string, number> {
  if (!isRecord(value))
    fail(label + " returned invalid probabilities for " + id + ".");
  const result = Object.create(null) as Record<string, number>;
  for (const [key, entry] of Object.entries(value)) {
    const index = Number(key);
    if (
      !/^\d+$/.test(key) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= levels
    ) {
      fail(
        label +
          " returned an unknown level in the probabilities for " +
          id +
          ".",
      );
    }
    const normalized = String(index);
    if (Object.hasOwn(result, normalized))
      fail(label + " returned duplicate probabilities for " + id + ".");
    result[normalized] = probability(
      label,
      entry,
      "probability for " + id + "." + key,
    );
  }
  for (let index = 0; index < levels; index += 1) {
    if (!Object.hasOwn(result, String(index)))
      fail(
        label + " did not return a probability for " + id + "." + index + ".",
      );
  }
  return checkDistribution(label, id, result);
}

function scoreValue(
  label: string,
  id: string,
  value: unknown,
  levels: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(label + " returned an invalid score for " + id + ".");
  const maximum = levels - 1;
  if (value < -EPSILON || value > maximum + EPSILON)
    fail(label + " returned a score outside the rubric for " + id + ".");
  return Math.min(maximum, Math.max(0, value));
}

function nonNegativeInteger(label: string, value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    fail(label + " returned an invalid " + field + ".");
  return value as number;
}

function codePointSlice(source: string, start: number, end: number): string {
  const characters = Array.from(source);
  if (start > end || end > characters.length) return "";
  return characters.slice(start, end).join("");
}

function parseTextSpans(
  label: string,
  id: string,
  value: unknown,
  sources: { state?: string; snippets?: string[] },
): TextSpan[] {
  if (!Array.isArray(value)) fail(label + " returned invalid spans for " + id + ".");
  return value.map((entry, index) => {
    if (!isRecord(entry))
      fail(label + " returned an invalid span for " + id + ".");
    const start = nonNegativeInteger(label, entry.start, "span offset for " + id);
    const end = nonNegativeInteger(label, entry.end, "span offset for " + id);
    if (typeof entry.text !== "string" || end < start)
      fail(label + " returned an invalid span for " + id + ".");
    let searchResult: number | undefined;
    if (entry.search_result !== undefined) {
      searchResult = nonNegativeInteger(
        label, entry.search_result, "search result index for " + id,
      );
      if (sources.snippets === undefined || searchResult >= sources.snippets.length)
        fail(label + " returned an unknown search result for " + id + ".");
    }
    const source = searchResult === undefined ? sources.state : sources.snippets![searchResult];
    if (source === undefined || codePointSlice(source, start, end) !== entry.text)
      fail(label + " returned a span that does not match its source for " + id + ".");
    const span: TextSpan = {
      start,
      end,
      text: entry.text,
      score: probability(label, entry.score, "span score for " + id + "." + index),
    };
    if (searchResult !== undefined) span.searchResult = searchResult;
    return span;
  });
}

function parseBox(
  label: string,
  id: string,
  value: unknown,
  confidence: unknown,
): Answer {
  if (!isRecord(value))
    fail(label + " returned an invalid box for " + id + ".");
  const top = unitInterval(label, value.top, "box edge for " + id);
  const bottom = unitInterval(label, value.bottom, "box edge for " + id);
  const left = unitInterval(label, value.left, "box edge for " + id);
  const right = unitInterval(label, value.right, "box edge for " + id);
  if (left >= right)
    fail(
      label +
        " returned a box for " +
        id +
        " whose left edge is not before its right edge.",
    );
  if (top >= bottom)
    fail(
      label +
        " returned a box for " +
        id +
        " whose top edge is not above its bottom edge.",
    );
  return {
    type: "box",
    box: { top, bottom, left, right },
    confidence: probability(label, confidence, "confidence for " + id),
  };
}

function parseTypedAnswer(
  label: string,
  id: string,
  question: Question,
  answer: unknown,
  sources: { state?: string; snippets?: string[] } = {},
): Answer {
  if (!isRecord(answer))
    fail(label + " returned an invalid answer for " + id + ".");
  if (answer.type === "refusal") return { type: "refusal" };
  if (question.type === "bool") {
    if (answer.type !== "noul")
      fail(label + " did not return a yes/no answer for " + id + ".");
    return {
      type: "bool",
      probability: probability(label, answer.noul, "probability for " + id),
    };
  }
  if (question.type === "choice") {
    if (answer.type !== "choice" || typeof answer.choice !== "string")
      fail(label + " did not return a choice answer for " + id + ".");
    if (!Object.hasOwn(question.criteria, answer.choice))
      fail(label + " returned an unknown choice for " + id + ".");
    const probabilities = labelProbabilities(
      label,
      id,
      answer.probabilities,
      Object.keys(question.criteria),
    );
    return {
      type: "choice",
      choice: answer.choice,
      probabilities,
      confidence: probability(label, answer.confidence, "confidence for " + id),
    };
  }
  if (question.type === "score") {
    if (answer.type !== "score")
      fail(label + " did not return a score answer for " + id + ".");
    const base = {
      type: "score" as const,
      score: scoreValue(label, id, answer.score, question.criteria.length),
      confidence: probability(label, answer.confidence, "confidence for " + id),
    };
    if (answer.probabilities === undefined) return base;
    return {
      ...base,
      probabilities: levelProbabilities(
        label,
        id,
        answer.probabilities,
        question.criteria.length,
      ),
    };
  }
  if (question.type === "locate") {
    if (answer.type !== "locate")
      fail(label + " did not return a locate answer for " + id + ".");
    return { type: "locate", spans: parseTextSpans(label, id, answer.spans, sources) };
  }
  if (answer.type !== "box")
    fail(label + " did not return a box answer for " + id + ".");
  return parseBox(label, id, answer.box, answer.confidence);
}

function validateDecision(label: string, id: string, answer: Answer): Answer {
  if (answer.type === "choice") {
    const maximum = Math.max(...Object.values(answer.probabilities));
    if (maximum - answer.probabilities[answer.choice]! > EPSILON)
      fail(
        label +
          " returned a choice inconsistent with its probabilities for " +
          id +
          ".",
      );
  } else if (answer.type === "score" && answer.probabilities) {
    const entries = Object.entries(answer.probabilities);
    const expected = entries.reduce(
      (total, [level, probability]) => total + Number(level) * probability,
      0,
    );
    if (
      Math.abs(answer.score - expected) >
      DISTRIBUTION_TOLERANCE * Math.max(1, entries.length - 1)
    )
      fail(
        label +
          " returned a score inconsistent with its probabilities for " +
          id +
          ".",
      );
  }
  return answer;
}

function parseTypedAnswers(
  label: string,
  value: unknown,
  questions: Record<string, Question>,
  sources: { state?: string; snippets?: string[] } = {},
): Record<string, Answer> {
  if (!isRecord(value)) fail(label + " returned an unexpected response.");
  // Question IDs may be "__proto__", so answers are collected without a prototype.
  const answers = Object.create(null) as Record<string, Answer>;
  for (const [id, question] of Object.entries(questions)) {
    if (!Object.hasOwn(value, id))
      fail(label + " did not return an answer for " + id + ".");
    answers[id] = validateDecision(
      label,
      id,
      parseTypedAnswer(label, id, question, value[id], sources),
    );
  }
  return answers;
}

/* OpenAI Decisions -------------------------------------------------------- */

function predicateInstructions(question: Extract<Question, { type: "bool" }>): QuestionContent {
  const meanings: string[] = [];
  if (question.criteria?.true) meanings.push("True means: " + textContent(question.criteria.true));
  if (question.criteria?.false) meanings.push("False means: " + textContent(question.criteria.false));
  if (meanings.length === 0) return question.instructions;
  const suffix = "\n" + meanings.join("\n");
  return typeof question.instructions === "string" ? question.instructions + suffix : [...question.instructions, suffix];
}

function openAiQuestion(id: string, question: Question, input: PreparedInput): Record<string, unknown> {
  const instructions = question.type === "bool" ? predicateInstructions(question) : question.instructions;
  const wireInstructions = typeof instructions === "string" ? instructions : openAiContent(instructions, input);
  if (question.type === "bool") return { type: "predicate", name: id, instructions: wireInstructions };
  if (question.type === "choice") return {
    type: "choice", name: id, instructions: wireInstructions,
    choices: Object.entries(question.criteria).map(([value, description]) => ({ value, description: textContent(description) })),
  };
  if (question.type === "score") return {
    type: "score", name: id, instructions: wireInstructions,
    levels: question.criteria.map((label) => ({ label: textContent(label) })),
  };
  throw unsupportedBox();
}

function openAiInput(input: PreparedInput): unknown {
  const text = typeof input.state === "string" ? input.state : JSON.stringify(input.state);
  const shared = input.images.filter((image) => image.id === undefined);
  const references = imageReferences(input.state);
  if (shared.length === 0 && references.length === 0) return text;
  return [{
    role: "user",
    content: [
      ...(references.length ? openAiContent(input.state, input) : [{ type: "input_text", text }]),
      ...shared.map((image) => ({ type: "input_image", image_url: imageUrl(image) })),
    ],
  }];
}

function openAiChoiceProbabilities(
  label: string,
  id: string,
  value: unknown,
  labels: string[],
): Record<string, number> {
  if (!Array.isArray(value))
    fail(label + " returned invalid probabilities for " + id + ".");
  const mapped = Object.create(null) as Record<string, unknown>;
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.value !== "string" ||
      !labels.includes(entry.value)
    ) {
      fail(
        label +
          " returned an unknown option in the probabilities for " +
          id +
          ".",
      );
    }
    if (Object.hasOwn(mapped, entry.value))
      fail(label + " returned duplicate probabilities for " + id + ".");
    mapped[entry.value] = entry.probability;
  }
  return labelProbabilities(label, id, mapped, labels);
}

function openAiLevelProbabilities(
  label: string,
  id: string,
  value: unknown,
  levels: number,
): Record<string, number> {
  if (!Array.isArray(value))
    fail(label + " returned invalid probabilities for " + id + ".");
  const mapped = Object.create(null) as Record<string, unknown>;
  for (const entry of value) {
    if (!isRecord(entry) || !Number.isInteger(entry.value))
      fail(
        label +
          " returned an unknown level in the probabilities for " +
          id +
          ".",
      );
    const index = entry.value as number;
    if (index < 0 || index >= levels || Object.hasOwn(mapped, String(index))) {
      fail(
        label +
          " returned an unknown level in the probabilities for " +
          id +
          ".",
      );
    }
    mapped[String(index)] = entry.probability;
  }
  return levelProbabilities(label, id, mapped, levels);
}

function parseOpenAiAnswer(
  label: string,
  id: string,
  question: Question,
  answer: unknown,
): Answer {
  if (!isRecord(answer))
    fail(label + " returned an invalid answer for " + id + ".");
  if (answer.type === "refusal") return { type: "refusal" };
  if (question.type === "bool") {
    if (answer.type !== "predicate")
      fail(label + " did not return a yes/no answer for " + id + ".");
    return {
      type: "bool",
      probability: probability(
        label,
        answer.probability,
        "probability for " + id,
      ),
    };
  }
  if (question.type === "choice") {
    if (answer.type !== "choice" || typeof answer.choice !== "string")
      fail(label + " did not return a choice answer for " + id + ".");
    if (!Object.hasOwn(question.criteria, answer.choice))
      fail(label + " returned an unknown choice for " + id + ".");
    return {
      type: "choice",
      choice: answer.choice,
      probabilities: openAiChoiceProbabilities(
        label,
        id,
        answer.probabilities,
        Object.keys(question.criteria),
      ),
      confidence: probability(label, answer.confidence, "confidence for " + id),
    };
  }
  if (question.type === "score") {
    if (answer.type !== "score")
      fail(label + " did not return a score answer for " + id + ".");
    const base = {
      type: "score" as const,
      score: scoreValue(label, id, answer.score, question.criteria.length),
      confidence: probability(label, answer.confidence, "confidence for " + id),
    };
    if (answer.probabilities === undefined) return base;
    return {
      ...base,
      probabilities: openAiLevelProbabilities(
        label,
        id,
        answer.probabilities,
        question.criteria.length,
      ),
    };
  }
  throw unsupportedBox();
}

function parseOpenAiAnswers(
  label: string,
  value: unknown,
  questions: Record<string, Question>,
): Record<string, Answer> {
  if (!Array.isArray(value)) fail(label + " returned an unexpected response.");
  const byName = new Map<string, unknown>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== "string")
      fail(label + " returned an unexpected response.");
    if (byName.has(entry.name)) fail(label + " returned duplicate answers.");
    byName.set(entry.name, entry);
  }
  // Question IDs may be "__proto__", so answers are collected without a prototype.
  const answers = Object.create(null) as Record<string, Answer>;
  for (const [id, question] of Object.entries(questions)) {
    const answer = byName.get(id);
    if (answer === undefined)
      fail(label + " did not return an answer for " + id + ".");
    answers[id] = validateDecision(
      label,
      id,
      parseOpenAiAnswer(label, id, question, answer),
    );
  }
  return answers;
}

async function classifyOpenAi(
  route: ResolvedModel,
  input: PreparedInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ClassifierResult> {
  const questions = Object.entries(input.questions).map(([id, question]) =>
    openAiQuestion(id, question, input),
  );
  const { body, requestId } = await postJson(
    route,
    "decisions",
    {
      model: route.model,
      input: openAiInput(input),
      questions,
    },
    apiKey,
    signal,
  );
  if (!isRecord(body)) fail(OPENAI_LABEL + " returned an unexpected response.");
  return finish(
    route,
    parseOpenAiAnswers(OPENAI_LABEL, body.answers, input.questions),
    body.usage,
    requestId,
  );
}

/* Perplexity Decisions ---------------------------------------------------- */

function systemOneQuestions(
  questions: Record<string, Question>,
  allowBox: boolean,
  content: (value: QuestionContent) => unknown = textContent,
): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === "box") {
      if (!allowBox) throw unsupportedBox();
      result[id] = { type: "box", instructions: content(question.instructions) };
      continue;
    }
    if (question.type === "locate") {
      result[id] = { type: "locate", instructions: content(question.instructions) };
      continue;
    }
    if (question.type !== "bool" && question.type !== "choice" && question.type !== "score")
      throw new ClassifierError(
        "capability",
        "The selected route does not support " + question.type + " questions.",
      );
    const wire: Record<string, unknown> = {
      type: question.type === "bool" ? "noul" : question.type,
      instructions: content(question.instructions),
    };
    if (question.type === "score") wire.criteria = question.criteria.map(content);
    else if (question.criteria !== undefined) wire.criteria = Object.fromEntries(
      Object.entries(question.criteria).map(([key, value]) => [key, content(value)]),
    );
    result[id] = wire;
  }
  return result;
}

function perplexityState(input: PreparedInput): unknown {
  // Only explicit references become native image parts; other JSON stays text.
  const text = typeof input.state === "string" ? input.state : JSON.stringify(input.state);
  const shared = input.images.filter((image) => image.id === undefined);
  const references = imageReferences(input.state);
  if (shared.length + references.length > 8)
    throw new ClassifierError("input", "Perplexity accepts at most eight image occurrences per question.");
  if (shared.length === 0 && references.length === 0) return text;
  return [
    ...(references.length ? imageContentParts(input.state, (id) => ({
      type: "image_url", image_url: { url: imageUrl(namedImage(input.images, id)) },
    })) : [text]),
    ...shared.map((image) => ({ type: "image_url", image_url: { url: imageUrl(image) } })),
  ];
}

function webEntry(entry: unknown, field: string): WebFetchedResult {
  if (
    !isRecord(entry) ||
    typeof entry.title !== "string" ||
    typeof entry.url !== "string" ||
    typeof entry.snippet !== "string"
  )
    fail(PERPLEXITY_LABEL + " returned an invalid " + field + " entry.");
  try {
    const url = new URL(entry.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    fail(PERPLEXITY_LABEL + " returned an invalid URL in " + field + ".");
  }
  return { title: entry.title, url: entry.url, snippet: entry.snippet };
}

function providerDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(PERPLEXITY_LABEL + " returned an invalid date in " + field + ".");
  return value;
}

function parseSearchResults(value: unknown): WebSearchResult[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    fail(PERPLEXITY_LABEL + " returned invalid search_results.");
  return value.map((entry) => {
    const base = webEntry(entry, "search_results");
    const result: WebSearchResult = { ...base };
    if (isRecord(entry) && entry.date !== undefined)
      result.date = providerDate(entry.date, "search_results");
    if (isRecord(entry) && entry.last_updated !== undefined)
      result.lastUpdated = providerDate(entry.last_updated, "search_results");
    return result;
  });
}

function parseFetchedResults(value: unknown): WebFetchedResult[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1)
    fail(PERPLEXITY_LABEL + " returned invalid fetched_results.");
  return value.map((entry) => webEntry(entry, "fetched_results"));
}

function withWebGroundingCost(
  cost: ClassifierResult["cost"],
  questionCount: number,
  fetched: number,
): ClassifierResult["cost"] {
  if (cost.status !== "estimated") return cost;
  const searchFeeMaximum = questionCount * 0.001;
  const fetchFee = fetched * 0.0005;
  return {
    ...cost,
    nonToken: {
      currency: "USD",
      webGrounding: {
        status: "estimated_maximum",
        searchesRequested: questionCount,
        searchFeeMaximum,
        successfulFetches: fetched,
        fetchFee,
        totalMaximum: searchFeeMaximum + fetchFee,
        note:
          "Perplexity bills one Fast Search per question before duplicate-query sharing and failed-search exclusions are known; exact billed searches are not returned. The token estimate already includes fetched page text and search evidence.",
      },
    },
  };
}

async function classifyPerplexity(
  route: ResolvedModel,
  input: PreparedInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ClassifierResult> {
  const state = perplexityState(input);
  const payload: Record<string, unknown> = {
    model: route.model,
    state,
    questions: systemOneQuestions(input.questions, false),
  };
  if (input.mode !== undefined) payload.mode = input.mode;
  if (input.maxStaleness !== undefined) payload.max_staleness = input.maxStaleness;
  const { body, requestId } = await postJson(
    route,
    "decisions",
    payload,
    apiKey,
    signal,
  );
  if (!isRecord(body))
    fail(PERPLEXITY_LABEL + " returned an unexpected response.");
  const searches = parseSearchResults(body.search_results);
  const fetched = parseFetchedResults(body.fetched_results);
  const snippets = searches.map((result) => result.snippet);
  const sources: { state?: string; snippets: string[] } = { snippets };
  if (typeof input.state === "string") sources.state = input.state;
  const result = finish(
    route,
    parseTypedAnswers(
      PERPLEXITY_LABEL,
      body.answers,
      input.questions,
      sources,
    ),
    body.usage,
    requestId,
  );
  if (input.mode === "web_grounding") {
    result.webGrounding = { searchResults: searches };
    if (fetched.length > 0) result.webGrounding.fetchedResults = fetched;
    result.cost = withWebGroundingCost(result.cost, Object.keys(input.questions).length, fetched.length);
  }
  return result;
}

/* Microsoft Foundry Decision-1 (text/JSON, API-key authentication) -------- */

async function classifyMicrosoft(
  route: ResolvedModel,
  input: PreparedInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ClassifierResult> {
  const label = "Microsoft Decision-1";
  const { body, requestId } = await postJson(
    route,
    "providers/microsoft/v1/systemone",
    {
      model: route.model, // Foundry deployment name, not necessarily the catalog model ID.
      state: input.state,
      questions: systemOneQuestions(input.questions, false),
    },
    apiKey,
    signal,
  );
  if (!isRecord(body) || !isRecord(body.answers))
    fail(label + " returned an unexpected response.");
  // Some System One endpoints omit confidence; derive it only from validated probabilities.
  const answers = Object.create(null) as Record<string, unknown>;
  for (const [id, question] of Object.entries(input.questions)) {
    const answer = Object.hasOwn(body.answers, id) ? body.answers[id] : undefined;
    if (
      isRecord(answer) &&
      answer.confidence === undefined &&
      answer.type !== "refusal"
    ) {
      if (question.type === "choice" && typeof answer.choice === "string") {
        const probabilities = labelProbabilities(
          label,
          id,
          answer.probabilities,
          Object.keys(question.criteria),
        );
        answers[id] = { ...answer, confidence: probabilities[answer.choice] };
      } else if (question.type === "score") {
        const probabilities = levelProbabilities(
          label,
          id,
          answer.probabilities,
          question.criteria.length,
        );
        answers[id] = {
          ...answer,
          confidence: Math.max(...Object.values(probabilities)),
        };
      } else answers[id] = answer;
    } else answers[id] = answer;
  }
  return finish(
    route,
    parseTypedAnswers(label, answers, input.questions),
    body.usage,
    requestId,
  );
}

/* TypeSafe System One (direct API and compatible gateways) --------------- */

function withImageRefs(state: PreparedInput["state"], refs: string[]): unknown {
  if (isRecord(state) && !Object.hasOwn(state, "images"))
    return { ...state, images: refs };
  return { state, images: refs };
}

async function classifySystemOne(
  route: ResolvedModel,
  input: PreparedInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ClassifierResult> {
  const assets = Object.create(null) as Record<string, unknown>;
  const sharedRefs: string[] = [];
  const namedRefs = new Map<string, string>();
  const used = new Set([...imageReferences(input.state), ...questionImageReferences(input.questions)]);
  for (const image of input.images) {
    // Batching can remove a question or a criterion. Jev rejects unused assets.
    if (image.id !== undefined && !used.has(image.id)) continue;
    if ("url" in image) throw new ClassifierError("capability", "Jev assets require local images.");
    const ref = randomUUID();
    if (image.id === undefined) sharedRefs.push(ref);
    else namedRefs.set(image.id, ref);
    assets[ref] = {
      type: "image", format: image.mimeType === "image/png" ? "png" : "jpg",
      data_base64: image.data,
    };
  }
  const reference = (id: string): string => {
    const ref = namedRefs.get(id);
    if (!ref) throw new ClassifierError("input", "Unknown named image reference.");
    return ref;
  };
  const state = mapImageReferences(input.state, reference) as PreparedInput["state"];
  const payload: Record<string, unknown> = {
    model: route.model,
    state: sharedRefs.length ? withImageRefs(state, sharedRefs) : state,
    questions: systemOneQuestions(input.questions, true, (value) => mapImageReferences(value, reference)),
  };
  if (Object.keys(assets).length > 0) payload.assets = assets;
  const experimentalHeader =
    Object.keys(assets).length > 0 ||
    Object.values(input.questions).some((question) => question.type === "box");
  const extraHeaders = experimentalHeader
    ? { "TypeSafe-Danger-Zone-Images": "true" }
    : undefined;
  const { body, requestId } = await postJson(
    route,
    "systemone",
    payload,
    apiKey,
    signal,
    extraHeaders,
  );
  if (!isRecord(body))
    fail(TYPESAFE_LABEL + " returned an unexpected response.");
  return finish(
    route,
    parseTypedAnswers(TYPESAFE_LABEL, body.answers, input.questions),
    body.usage,
    requestId,
  );
}

/* Cloudflare Workers AI (Clef and third-party System One envelopes) ------- */

function clefBodyModel(model: string): string | undefined {
  return /^@cf\/cloudflare\/(clef(?:-flash|-omni)?)$/.exec(model)?.[1];
}

function cloudflareMedia(media: PreparedMedia[]): { content_type: string; base64: string }[] {
  return media.map((entry) => ({ content_type: entry.mimeType, base64: entry.data }));
}

export function unwrapCloudflare(
  label: string,
  body: unknown,
): Record<string, unknown> {
  if (!isRecord(body)) fail(label + " returned an unexpected response.");
  if (body.success === false)
    fail(
      label +
        " reported that the request failed. Check credentials, model, limits and provider availability.",
    );
  let candidate: Record<string, unknown> = body;
  if (body.result !== undefined) {
    if (!isRecord(body.result))
      fail(label + " returned an unexpected response.");
    candidate = body.result;
  }
  if (isRecord(candidate.answers)) return candidate;
  if (candidate.state !== undefined && candidate.state !== "Completed")
    fail(label + " did not complete the request.");
  if (isRecord(candidate.result) && isRecord(candidate.result.answers))
    return candidate.result;
  fail(label + " returned an unexpected response.");
}

async function classifyCloudflare(
  route: ResolvedModel,
  input: PreparedInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ClassifierResult> {
  const clefModel = clefBodyModel(route.model);
  let path: string;
  let payload: Record<string, unknown>;
  if (clefModel !== undefined) {
    payload = {
      model: clefModel,
      state: input.state,
      questions: systemOneQuestions(input.questions, false),
    };
    if (input.images.length > 0) {
      payload.images = input.images.map((image) => {
        if ("url" in image) throw new ClassifierError("capability", "Clef requires local images.");
        return { content_type: image.mimeType, base64: image.data };
      });
    }
    const audio = input.media.filter((media) => media.type === "audio");
    const videos = input.media.filter((media) => media.type === "video");
    if (audio.length) payload.audio = cloudflareMedia(audio);
    if (videos.length) payload.videos = cloudflareMedia(videos);
    path = "run/" + route.model;
  } else {
    if (input.images.length > 0 || input.media.length > 0)
      throw new ClassifierError(
        "capability",
        "The selected route does not support media for this model.",
      );
    payload = {
      model: route.model,
      input: {
        state: input.state,
        questions: systemOneQuestions(input.questions, false),
      },
    };
    path = "run";
  }
  const { body, requestId } = await postJson(
    route,
    path,
    payload,
    apiKey,
    signal,
  );
  const result = unwrapCloudflare(CLOUDFLARE_LABEL, body);
  const usage =
    normalizedUsage(result.usage) !== undefined
      ? result.usage
      : isRecord(body)
        ? body.usage
        : undefined;
  return finish(
    route,
    parseTypedAnswers(CLOUDFLARE_LABEL, result.answers, input.questions),
    usage,
    requestId,
  );
}

/* Liquid d1.2 System One extension --------------------------------------- */

function liquidUnsupported(feature: string): never {
  throw new ClassifierError(
    "capability",
    "The selected route does not support " + feature + ".",
  );
}

function liquidQuestion(id: string, question: Question): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    type: question.type === "bool" ? "noul" : question.type,
    instructions: textContent(question.instructions),
  };
  switch (question.type) {
    case "bool":
      if (question.criteria)
        wire.criteria = Object.fromEntries(
          Object.entries(question.criteria).map(([key, value]) => [key, textContent(value)]),
        );
      return wire;
    case "choice":
    case "multi_choice":
      wire.type = "choice";
      wire.criteria = Object.fromEntries(
        Object.entries(question.criteria).map(([key, value]) => [key, textContent(value)]),
      );
      if (question.type === "multi_choice") wire.multiple = true;
      return wire;
    case "score":
      wire.criteria = question.criteria.map(textContent);
      return wire;
    case "number":
      if (question.unit !== undefined) wire.unit = question.unit;
      if (question.range !== undefined) wire.range = question.range;
      if (question.step !== undefined) wire.step = question.step;
      return wire;
    case "spans":
    case "boxes":
      if (question.max !== undefined) wire.max = question.max;
      return wire;
    case "estimate":
      wire.type = "number";
      wire.range = question.range;
      if (question.step !== undefined) wire.step = question.step;
      if (question.unit !== undefined) wire.unit = question.unit;
      return wire;
    case "text":
    case "date":
    case "box":
      return wire;
    case "locate":
      return liquidUnsupported("locate questions on Liquid routes");
  }
}

function stateText(state: PreparedInput["state"]): string {
  return typeof state === "string" ? state : JSON.stringify(state, null, 2);
}

function optionalCharSpan(
  label: string,
  value: unknown,
  field: string,
  text: string,
): [number, number] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return charSpan(label, value, field, text);
}

function charSpan(label: string, value: unknown, field: string, text: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 ||
      value.some((entry) => !Number.isSafeInteger(entry) || (entry as number) < 0))
    fail(label + " returned an invalid " + field + ".");
  const start = value[0] as number;
  const end = value[1] as number;
  if (end < start || codePointSlice(text, start, end).length === 0 && end !== start)
    fail(label + " returned an invalid " + field + ".");
  return [start, end];
}

function optionalFound(label: string, answer: Record<string, unknown>, id: string): number | undefined {
  return answer.found === undefined ? undefined : probability(label, answer.found, "found for " + id);
}

function parseLiquidAnswer(
  label: string,
  id: string,
  question: Question,
  answer: unknown,
  text: string,
): Answer | undefined {
  if (!isRecord(answer)) fail(label + " returned an invalid answer for " + id + ".");
  if (answer.type === "refusal") return { type: "refusal" };
  if (question.type === "bool" || question.type === "choice" || question.type === "score")
    return validateDecision(label, id, parseTypedAnswer(label, id, question, answer));
  const found = optionalFound(label, answer, id);
  if (question.type === "text") {
    if (typeof answer.text !== "string") fail(label + " returned an invalid text answer for " + id + ".");
    const result: Extract<Answer, { type: "text" }> = { type: "text", text: answer.text };
    const span = optionalCharSpan(label, answer.span, "span for " + id, text);
    if (span !== undefined) result.span = span;
    if (found !== undefined) result.found = found;
    return result;
  }
  if (question.type === "number") {
    if (answer.number !== null && (typeof answer.number !== "number" || !Number.isFinite(answer.number)))
      fail(label + " returned an invalid number answer for " + id + ".");
    const value = typeof answer.number === "number" ? answer.number : null;
    const result: Extract<Answer, { type: "number" }> = { type: "number", value };
    if (typeof answer.unit === "string" || answer.unit === null) result.unit = answer.unit;
    if (typeof answer.text === "string" || answer.text === null) result.text = answer.text;
    const span = optionalCharSpan(label, answer.span, "span for " + id, text);
    if (span !== undefined) result.span = span;
    if (found !== undefined) result.found = found;
    return result;
  }
  if (question.type === "date") {
    if (answer.date !== null && (typeof answer.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(answer.date)))
      fail(label + " returned an invalid date answer for " + id + ".");
    const date = typeof answer.date === "string" ? answer.date : null;
    const result: Extract<Answer, { type: "date" }> = { type: "date", date };
    if (typeof answer.text === "string" || answer.text === null) result.text = answer.text;
    const span = optionalCharSpan(label, answer.span, "span for " + id, text);
    if (span !== undefined) result.span = span;
    if (found !== undefined) result.found = found;
    return result;
  }
  if (question.type === "spans") {
    if (!Array.isArray(answer.spans) || !Array.isArray(answer.presence) ||
        !Number.isSafeInteger(answer.count) || (answer.count as number) < 0 ||
        typeof answer.at_least !== "boolean")
      fail(label + " returned an invalid spans answer for " + id + ".");
    const presence = answer.presence.map((entry) => probability(label, entry, "presence for " + id));
    return {
      type: "spans",
      spans: answer.spans.map((entry) => {
        if (!isRecord(entry) || typeof entry.text !== "string")
          fail(label + " returned an invalid span for " + id + ".");
        return {
          text: entry.text,
          span: charSpan(label, entry.span, "span for " + id, text),
          found: probability(label, entry.found, "span found for " + id),
        };
      }),
      count: answer.count as number,
      atLeast: answer.at_least,
      presence,
    };
  }
  if (question.type === "boxes") {
    if (!Array.isArray(answer.boxes) || !Array.isArray(answer.presence) ||
        !Number.isSafeInteger(answer.count) || (answer.count as number) < 0 ||
        typeof answer.at_least !== "boolean")
      fail(label + " returned an invalid boxes answer for " + id + ".");
    const presence = answer.presence.map((entry) => probability(label, entry, "presence for " + id));
    return {
      type: "boxes",
      boxes: answer.boxes.map((entry) => {
        const parsed = parseBox(label, id, isRecord(entry) ? entry.box : undefined, isRecord(entry) ? entry.found : undefined);
        if (parsed.type !== "box") fail(label + " returned an invalid box for " + id + ".");
        return {
          box: parsed.box,
          found: parsed.confidence,
          confidence: probability(label, isRecord(entry) ? entry.confidence : undefined, "box confidence for " + id),
        };
      }),
      count: answer.count as number,
      atLeast: answer.at_least,
      presence,
    };
  }
  if (question.type === "estimate") {
    const value = answer.number;
    if (typeof value !== "number" || !Number.isFinite(value) || !Array.isArray(answer.interval) ||
        answer.interval.length !== 2 ||
        answer.interval.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)) ||
        (answer.interval[0] as number) > value || value > (answer.interval[1] as number))
      fail(label + " returned an invalid estimate for " + id + ".");
    const result: Extract<Answer, { type: "estimate" }> = {
      type: "estimate",
      value,
      interval: [answer.interval[0] as number, answer.interval[1] as number],
    };
    if (typeof answer.unit === "string") result.unit = answer.unit;
    return result;
  }
  if (question.type === "multi_choice") {
    if (!Array.isArray(answer.choices) || !isRecord(answer.probabilities))
      fail(label + " returned an invalid multi-choice answer for " + id + ".");
    const labels = Object.keys(question.criteria);
    const choices = independentLabelProbabilities(label, id, answer.probabilities, labels);
    for (const choice of answer.choices) {
      if (typeof choice !== "string" || !Object.hasOwn(question.criteria, choice))
        fail(label + " returned an unknown choice for " + id + ".");
    }
    return { type: "multi_choice", choices: answer.choices as string[], probabilities: choices };
  }
  if (question.type === "box") {
    if (answer.box === null || (found !== undefined && found < 0.5)) return { type: "no_match" };
    const parsed = parseBox(label, id, answer.box, answer.confidence);
    if (parsed.type !== "box") fail(label + " returned an invalid box for " + id + ".");
    return found === undefined ? parsed : { ...parsed, found };
  }
  return liquidUnsupported("question type " + question.type);
}

async function classifyLiquid(
  route: ResolvedModel,
  input: PreparedInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ClassifierResult> {
  if (Object.values(input.questions).some((question) => question.type === "locate"))
    return liquidUnsupported("locate questions on Liquid routes");
  const payload: Record<string, unknown> = {
    model: route.model,
    state: input.state,
    questions: Object.fromEntries(
      Object.entries(input.questions).map(([id, question]) => [id, liquidQuestion(id, question)]),
    ),
  };
  if (input.images.length) {
    payload.images = input.images.map((image) => {
      if ("url" in image) throw new ClassifierError("capability", "Liquid requires local images.");
      return { content_type: image.mimeType, base64: image.data };
    });
  }
  const audio = input.media.filter((media) => media.type === "audio");
  if (audio.length)
    payload.audio = audio.map((media) => ({ content_type: media.mimeType, base64: media.data }));
  const { body, requestId } = await postJson(route, "systemone", payload, apiKey, signal);
  if (!isRecord(body)) fail("Liquid Decisions returned an unexpected response.");
  const text = stateText(input.state);
  const answers = Object.create(null) as Record<string, Answer>;
  for (const [id, question] of Object.entries(input.questions)) {
    if (!isRecord(body.answers) || !Object.hasOwn(body.answers, id))
      fail("Liquid Decisions did not return an answer for " + id + ".");
    const parsed = parseLiquidAnswer("Liquid Decisions", id, question, body.answers[id], text);
    if (parsed !== undefined) answers[id] = parsed;
  }
  return finish(route, answers, body.usage, requestId);
}
