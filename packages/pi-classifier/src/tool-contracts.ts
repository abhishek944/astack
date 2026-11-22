import { Type } from "typebox";

/**
 * Tool names, descriptions and argument/result schemas shared by the Pi desktop extension and the
 * native Durable factory. Both surfaces must accept and report exactly the same contract, so these
 * live here rather than in either adapter. Pi-only registration fields (label, prompt guidance,
 * annotations, outputSchema) stay with the desktop registrations.
 */

export const CLASSIFY_TOOL = "classify";
export const CLASSIFY_COMPARE_TOOL = "classify_compare";
export const CLASSIFY_TREE_TOOL = "classify_tree";
export const CLASSIFIER_BOX_TOOL = "classifier_box_image";

export const CLASSIFY_TOOL_DESCRIPTION =
  "Ask a decision model typed questions about text, JSON, images and supported audio/video. Legacy image paths are shared; named path/url descriptors require explicit {$image:id} references. Jev supports images in instructions/criteria; OpenAI supports instruction images and hosted URLs. Unsupported placements fail locally. Returns bool probabilities, choices, scores, Perplexity locate spans, Liquid reads/estimates/multi-select answers and boxes, plus reported token usage and estimated USD cost (or an explicit unavailable reason). mode: web_grounding is an explicit Perplexity opt-in that sends question text and the start of state to web search and adds billed searches/fetches; cost.nonToken reports the documented fees. Experimental Jev box answers require explicit configuration. Provider/model are fixed by pi-classifier.default (or legacy defaultProvider/defaultModel); this tool cannot override them. API-key authentication is independent of Codex chat login. Only explicitly configured fallback routes may be used after a missing key or HTTP 401/404/429 before any batch has completed; never after uncertainty, refusals, timeouts or network failures. Use /classifier list or status to inspect configuration.";

export const CLASSIFY_COMPARE_TOOL_DESCRIPTION =
  "Explicitly compare the same typed questions and state using exactly pi-classifier.compare provider/model pairs. Each entry makes potentially billable requests, including multiple requests when choice batching is configured. No fallback, default substitution, provider/model overrides, or default changes. Returns labeled results, duration, usage, estimated USD costs (or unavailable reasons) and safe per-entry failures; cancellation retains completed results and prevents later requests.";

export const CLASSIFY_TREE_TOOL_DESCRIPTION =
  "Classify text, JSON or supported images through a nested classification tree. tree is an inline roots/id/description/children object or a local JSON file inside cwd. Choose among siblings, automatically follow sole children without model calls, and return Level1/Level2/etc under levels with per-step provenance, total providerCalls, reported usage and estimated USD cost. NONE, batching and initial fallback follow configured settings; after a successful decision the route is pinned. no_match, ambiguous and refusal retain only the selected prefix. Automatic steps are structural, not model confirmation; greedy traversal is not a global best-path guarantee. No provider/model override or comparison.";

export const CLASSIFIER_BOX_TOOL_DESCRIPTION =
  "Render a normalized bounding box on a local image, or crop to it, entirely locally. Use to inspect a box answer from classify. overlay keeps the image and draws a rectangle; crop returns only the clamped region. Returns a PNG plus exact source-pixel box metadata. No provider request, upload, resizing or disk write. A box is a localization hint, not proof that the object exists.";

const imageReference = Type.Object(
  { $image: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }) },
  { additionalProperties: false },
);

function imageContent(maxLength: number, nonempty = false) {
  return Type.Union([
    Type.String({ maxLength, ...(nonempty ? { minLength: 1 } : {}) }),
    Type.Array(Type.Union([Type.String({ maxLength }), imageReference]), {
      minItems: 1,
      maxItems: 128,
      description:
        "Ordered text and explicit {$image:id} references. References require named images; supported placements depend on the route.",
    }),
  ]);
}

const shortText = imageContent(4096);
const instructionContent = imageContent(16384, true);

const charSpan = Type.Tuple([
  Type.Integer({ minimum: 0 }),
  Type.Integer({ minimum: 0 }),
]);

// Numeric estimation ranges may be negative or fractional; they are not text offsets.
const numericRange = Type.Tuple([Type.Number(), Type.Number()]);

const boxEdges = Type.Object(
  {
    top: Type.Number(),
    bottom: Type.Number(),
    left: Type.Number(),
    right: Type.Number(),
  },
  { additionalProperties: false },
);

const textSpan = Type.Object(
  {
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 0 }),
    text: Type.String(),
    score: Type.Number({ minimum: 0, maximum: 1 }),
    searchResult: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const webSearchResult = Type.Object(
  {
    title: Type.String(),
    url: Type.String(),
    snippet: Type.String(),
    date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    lastUpdated: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  },
  { additionalProperties: false },
);

const webFetchedResult = Type.Object(
  { title: Type.String(), url: Type.String(), snippet: Type.String() },
  { additionalProperties: false },
);

const nonTokenCost = Type.Object(
  {
    currency: Type.Literal("USD"),
    webGrounding: Type.Object(
      {
        status: Type.Literal("estimated_maximum"),
        searchesRequested: Type.Integer({ minimum: 0 }),
        searchFeeMaximum: Type.Number({ minimum: 0 }),
        successfulFetches: Type.Integer({ minimum: 0 }),
        fetchFee: Type.Number({ minimum: 0 }),
        totalMaximum: Type.Number({ minimum: 0 }),
        note: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const question = Type.Union([
  Type.Object(
    {
      type: Type.Literal("bool"),
      instructions: instructionContent,
      criteria: Type.Optional(
        Type.Object(
          { true: Type.Optional(shortText), false: Type.Optional(shortText) },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("choice"),
      instructions: instructionContent,
      criteria: Type.Record(
        Type.String({ minLength: 1, maxLength: 128 }),
        shortText,
        { minProperties: 1 },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("score"),
      instructions: instructionContent,
      criteria: Type.Array(imageContent(4096, true), {
        minItems: 2,
        maxItems: 10,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("box"),
      instructions: instructionContent,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("locate"),
      instructions: instructionContent,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("text"), instructions: instructionContent },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("number"),
      instructions: instructionContent,
      unit: Type.Optional(Type.String({ maxLength: 128 })),
      range: Type.Optional(numericRange),
      step: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("date"), instructions: instructionContent },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("spans"),
      instructions: instructionContent,
      max: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("boxes"),
      instructions: instructionContent,
      max: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("estimate"),
      instructions: instructionContent,
      range: numericRange,
      step: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      unit: Type.Optional(Type.String({ maxLength: 128 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("multi_choice"),
      instructions: instructionContent,
      criteria: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), shortText, { minProperties: 2 }),
    },
    { additionalProperties: false },
  ),
]);

export const classifyParameters = Type.Object(
  {
    state: Type.Union(
      [
        Type.String(),
        Type.Record(Type.String(), Type.Unknown()),
        Type.Array(Type.Unknown()),
      ],
      {
        description:
          "Text or JSON data to classify. Use explicit {$image:id} objects to place named images in state on Jev, OpenAI or Perplexity. Other JSON remains data. All questions refer to this same state.",
      },
    ),
    questions: Type.Record(
      Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
      question,
      { minProperties: 1, maxProperties: 32 },
    ),
    mode: Type.Optional(
      Type.Literal("web_grounding"),
    ),
    maxStaleness: Type.Optional(Type.Integer({ minimum: 0 })),
    media: Type.Optional(
      Type.Array(
        Type.Object(
          {
            type: Type.Union([Type.Literal("audio"), Type.Literal("video")]),
            path: Type.String({ minLength: 1, maxLength: 4096 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    images: Type.Optional(
      Type.Array(
        Type.Union([
          Type.String({ minLength: 1, maxLength: 4096 }),
          Type.Object(
            {
              id: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
              path: Type.String({ minLength: 1, maxLength: 4096 }),
            },
            { additionalProperties: false },
          ),
          Type.Object(
            {
              id: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
              url: Type.String({ minLength: 1, maxLength: 4096 }),
            },
            { additionalProperties: false },
          ),
        ]),
        {
          maxItems: 8,
          description:
            "Legacy local paths are shared in order. Named {id,path} or {id,url} images must be referenced using {$image:id} in state or supported question content. URLs are OpenAI-only and sent to the provider, never fetched locally. No inline base64 or symlinks. Limits: Perplexity and Liquid 8 images, Clef 4, others 5.",
        },
      ),
    ),
  },
  { additionalProperties: false },
);

const tokenPricing = Type.Object({
  inputPerMillion: Type.Number({ minimum: 0 }),
  outputPerMillion: Type.Number({ minimum: 0 }),
  cachedInputPerMillion: Type.Optional(Type.Number({ minimum: 0 })),
  cacheWritePerMillion: Type.Optional(Type.Number({ minimum: 0 })),
});

export const classifyOutput = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  answers: Type.Record(
    Type.String(),
    Type.Union([
      Type.Object({
        type: Type.Literal("bool"),
        probability: Type.Number({ minimum: 0, maximum: 1 }),
      }),
      Type.Object({
        type: Type.Literal("choice"),
        choice: Type.String(),
        probabilities: Type.Record(
          Type.String(),
          Type.Number({ minimum: 0, maximum: 1 }),
        ),
        confidence: Type.Number({ minimum: 0, maximum: 1 }),
        probabilityScope: Type.Optional(Type.Literal("batch")),
        noneOfAboveProbability: Type.Optional(
          Type.Number({ minimum: 0, maximum: 1 }),
        ),
      }),
      Type.Object({
        type: Type.Literal("score"),
        score: Type.Number(),
        confidence: Type.Number({ minimum: 0, maximum: 1 }),
        probabilities: Type.Optional(
          Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 })),
        ),
      }),
      Type.Object({
        type: Type.Literal("box"),
        box: Type.Object({
          top: Type.Number(),
          bottom: Type.Number(),
          left: Type.Number(),
          right: Type.Number(),
        }),
        confidence: Type.Number({ minimum: 0, maximum: 1 }),
        found: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      }),
      Type.Object({ type: Type.Literal("locate"), spans: Type.Array(textSpan) }),
      Type.Object({
        type: Type.Literal("text"),
        text: Type.String(),
        span: Type.Optional(Type.Union([charSpan, Type.Null()])),
        found: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      }),
      Type.Object({
        type: Type.Literal("number"),
        value: Type.Union([Type.Number(), Type.Null()]),
        unit: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        span: Type.Optional(Type.Union([charSpan, Type.Null()])),
        found: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      }),
      Type.Object({
        type: Type.Literal("date"),
        date: Type.Union([Type.String(), Type.Null()]),
        text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        span: Type.Optional(Type.Union([charSpan, Type.Null()])),
        found: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      }),
      Type.Object({
        type: Type.Literal("spans"),
        spans: Type.Array(Type.Object({
          text: Type.String(),
          span: charSpan,
          found: Type.Number({ minimum: 0, maximum: 1 }),
        }, { additionalProperties: false })),
        count: Type.Integer({ minimum: 0 }),
        atLeast: Type.Boolean(),
        presence: Type.Array(Type.Number({ minimum: 0, maximum: 1 })),
      }),
      Type.Object({
        type: Type.Literal("boxes"),
        boxes: Type.Array(Type.Object({
          box: boxEdges,
          found: Type.Number({ minimum: 0, maximum: 1 }),
          confidence: Type.Number({ minimum: 0, maximum: 1 }),
        }, { additionalProperties: false })),
        count: Type.Integer({ minimum: 0 }),
        atLeast: Type.Boolean(),
        presence: Type.Array(Type.Number({ minimum: 0, maximum: 1 })),
      }),
      Type.Object({
        type: Type.Literal("estimate"),
        value: Type.Number(),
        interval: numericRange,
        unit: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      Type.Object({
        type: Type.Literal("multi_choice"),
        choices: Type.Array(Type.String()),
        probabilities: Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 })),
      }),
      Type.Object({ type: Type.Literal("refusal") }),
      Type.Object({ type: Type.Literal("no_match") }),
      Type.Object({ type: Type.Literal("ambiguous") }),
    ]),
  ),
  providerCalls: Type.Optional(Type.Integer({ minimum: 1 })),
  usage: Type.Optional(
    Type.Object({
      inputTokens: Type.Number(),
      outputTokens: Type.Number(),
      totalTokens: Type.Number(),
      cachedInputTokens: Type.Optional(Type.Number()),
      cacheWriteTokens: Type.Optional(Type.Number()),
    }),
  ),
  cost: Type.Union([
    Type.Object({
      status: Type.Literal("estimated"),
      currency: Type.Literal("USD"),
      input: Type.Number({ minimum: 0 }),
      output: Type.Number({ minimum: 0 }),
      total: Type.Number({ minimum: 0 }),
      source: Type.Union([Type.Literal("builtin"), Type.Literal("configured")]),
      rates: tokenPricing,
      nonToken: Type.Optional(nonTokenCost),
    }),
    Type.Object({
      status: Type.Literal("estimated"),
      currency: Type.Literal("USD"),
      input: Type.Number({ minimum: 0 }),
      output: Type.Number({ minimum: 0 }),
      total: Type.Number({ minimum: 0 }),
      source: Type.Literal("aggregated"),
      nonToken: Type.Optional(nonTokenCost),
    }),
    Type.Object({
      status: Type.Literal("unavailable"),
      currency: Type.Literal("USD"),
      reason: Type.Union([
        Type.Literal("unknown_pricing"),
        Type.Literal("missing_usage"),
        Type.Literal("invalid_usage"),
        Type.Literal("missing_cache_pricing"),
        Type.Literal("calculation_overflow"),
      ]),
    }),
  ]),
  requestId: Type.Optional(Type.String()),
  webGrounding: Type.Optional(
    Type.Object(
      {
        searchResults: Type.Array(webSearchResult),
        fetchedResults: Type.Optional(Type.Array(webFetchedResult)),
      },
      { additionalProperties: false },
    ),
  ),
  attemptedRoutes: Type.Optional(
    Type.Array(Type.Object({ provider: Type.String(), model: Type.String() })),
  ),
});

export const classifyCompareOutput = Type.Object({
  cancelled: Type.Boolean(),
  results: Type.Array(
    Type.Union([
      Type.Object({
        provider: Type.String(),
        model: Type.String(),
        durationMs: Type.Number(),
        status: Type.Literal("success"),
        result: classifyOutput,
      }),
      Type.Object({
        provider: Type.String(),
        model: Type.String(),
        durationMs: Type.Number(),
        status: Type.Literal("error"),
        error: Type.Object({ code: Type.String(), message: Type.String() }),
      }),
    ]),
  ),
});

// The model-facing JSON schema avoids $ref: recursive validation stays in loadTreeInput.
const classificationTreeNode = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    children: Type.Optional(
      Type.Array(
        Type.Unknown({
          description: "A nested tree node with the same id, description and children shape.",
        }),
        { minItems: 1 },
      ),
    ),
  },
  { additionalProperties: false },
);

export const classifyTreeParameters = Type.Object(
  {
    state: classifyParameters.properties.state,
    tree: Type.Union([
      Type.String({
        minLength: 1,
        maxLength: 4096,
        description: "Local UTF-8 JSON file inside cwd; no URLs or symlinks.",
      }),
      Type.Object(
        {
          roots: Type.Array(classificationTreeNode, {
            minItems: 1,
          }),
        },
        { additionalProperties: false },
      ),
    ]),
    instructions: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
    images: classifyParameters.properties.images,
  },
  { additionalProperties: false },
);

export const classifyTreeOutput = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  status: Type.Union([
    Type.Literal("complete"),
    Type.Literal("no_match"),
    Type.Literal("ambiguous"),
    Type.Literal("refusal"),
  ]),
  levels: Type.Record(Type.String({ pattern: "^Level[1-9][0-9]*$" }), Type.String()),
  steps: Type.Array(
    Type.Object({
      level: Type.Integer({ minimum: 1 }),
      id: Type.String(),
      source: Type.Union([Type.Literal("automatic"), Type.Literal("model")]),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      probabilityScope: Type.Optional(
        Type.Union([Type.Literal("siblings"), Type.Literal("batch")]),
      ),
      noneOfAboveProbability: Type.Optional(
        Type.Number({ minimum: 0, maximum: 1 }),
      ),
    }),
  ),
  providerCalls: Type.Integer({ minimum: 0 }),
  cost: classifyOutput.properties.cost,
  usage: classifyOutput.properties.usage,
  attemptedRoutes: classifyOutput.properties.attemptedRoutes,
});

export const boxParameters = Type.Object(
  {
    image: Type.String({
      minLength: 1,
      maxLength: 4096,
      description:
        "Local PNG, JPEG or WebP file inside cwd. No URLs, symlinks or inline base64.",
    }),
    box: Type.Object(
      {
        top: Type.Number({ minimum: 0, maximum: 1 }),
        bottom: Type.Number({ minimum: 0, maximum: 1 }),
        left: Type.Number({ minimum: 0, maximum: 1 }),
        right: Type.Number({ minimum: 0, maximum: 1 }),
      },
      {
        additionalProperties: false,
        description:
          "Normalized edges between 0 and 1, with top < bottom and left < right.",
      },
    ),
    mode: Type.Optional(
      Type.Union([Type.Literal("overlay"), Type.Literal("crop")], {
        description:
          "overlay draws the box on the image (default); crop returns only the boxed region.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const boxOutput = Type.Object({
  mode: Type.Union([Type.Literal("overlay"), Type.Literal("crop")]),
  mimeType: Type.Literal("image/png"),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  pixelBox: Type.Object({
    left: Type.Integer({ minimum: 0 }),
    top: Type.Integer({ minimum: 0 }),
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
  }),
  byteLength: Type.Integer({ minimum: 1 }),
});

/* Cloudflare Clairic extraction ------------------------------------------ */

export const CLASSIFY_EXTRACT_TOOL = "classify_extract";
export const CLASSIFY_EXTRACT_TOOL_DESCRIPTION =
  "Extract typed fields with Cloudflare Clairic using the configured clairic-api route. fields maps names to provider field specifications such as text, number, date, enum, object, list, estimate and forecast; nested object/list fields are supported. State is text/JSON and optional images or embedded PDF paths are sent to the provider. Returns typed values with optional grounding metadata plus reported token usage and estimated USD cost. Rendering is provider-owned; truncated reports incomplete generated fields. The tool cannot override the provider or model.";

// The model-facing JSON schema avoids $ref: validation of nested fields is runtime-owned.
const extractionFieldDefinition = Type.Object(
  {
    type: Type.Union([
      Type.Literal("text"), Type.Literal("number"), Type.Literal("compute"),
      Type.Literal("date"), Type.Literal("time"), Type.Literal("datetime"),
      Type.Literal("duration"), Type.Literal("boolean"), Type.Literal("enum"),
      Type.Literal("object"), Type.Literal("list"), Type.Literal("estimate"),
      Type.Literal("forecast"),
    ]),
    instructions: Type.Optional(Type.String({ maxLength: 16_384 })),
    nullable: Type.Optional(Type.Boolean()),
    unit: Type.Optional(Type.String({ maxLength: 128 })),
    integer: Type.Optional(Type.Boolean()),
    decimals: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
    minimum: Type.Optional(Type.Number()),
    maximum: Type.Optional(Type.Number()),
    exclusiveMinimum: Type.Optional(Type.Number()),
    exclusiveMaximum: Type.Optional(Type.Number()),
    minLength: Type.Optional(Type.Integer({ minimum: 0 })),
    maxLength: Type.Optional(Type.Integer({ minimum: 0 })),
    pattern: Type.Optional(Type.String({ maxLength: 4096 })),
    enum: Type.Optional(Type.Array(Type.Unknown(), { minItems: 1 })),
    knowledge: Type.Optional(Type.Boolean()),
    source_only: Type.Optional(Type.Boolean()),
    null_threshold: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1 })),
    properties: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Unknown({
          description: "A nested Clairic field specification with the same keys as this object.",
        }),
        { minProperties: 1 },
      ),
    ),
    items: Type.Optional(
      Type.Union([
        Type.Literal("text"), Type.Literal("number"), Type.Literal("date"),
        Type.Object(
          {
            type: Type.Literal("object"),
            properties: Type.Record(
              Type.String(),
              Type.Unknown({
                description: "A nested Clairic field specification with the same keys as this object.",
              }),
              { minProperties: 1 },
            ),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    max_items: Type.Optional(Type.Integer({ minimum: 0 })),
    min: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    max: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    step: Type.Optional(Type.Union([
      Type.Number({ exclusiveMinimum: 0 }),
      Type.Literal("minute"), Type.Literal("hour"), Type.Literal("day"),
      Type.Literal("week"), Type.Literal("month"), Type.Literal("quarter"), Type.Literal("year"),
    ])),
    scale: Type.Optional(Type.Union([Type.Literal("linear"), Type.Literal("log")])),
    horizon: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
    interval: Type.Optional(Type.Union([
      Type.Literal("step"), Type.Literal("minute"), Type.Literal("hour"),
      Type.Literal("day"), Type.Literal("week"), Type.Literal("month"),
      Type.Literal("quarter"), Type.Literal("year"),
    ])),
  },
  { additionalProperties: false },
);

export const classifyExtractParameters = Type.Object(
  {
    state: Type.Optional(classifyParameters.properties.state),
    fields: Type.Record(
      Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_.-]{0,63}$" }),
      extractionFieldDefinition,
      { minProperties: 1 },
    ),
    images: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 4 })),
    documents: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 4 })),
    referenceDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    options: Type.Optional(
      Type.Object(
        {
          includeQuantiles: Type.Optional(Type.Boolean()),
          returnStateText: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const classifyExtractOutput = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  answers: Type.Record(
    Type.String(),
    Type.Object(
      { type: Type.String(), value: Type.Unknown() },
      { additionalProperties: true },
    ),
  ),
  truncated: Type.Boolean(),
  usage: Type.Optional(classifyOutput.properties.usage),
  cost: classifyOutput.properties.cost,
  requestId: Type.Optional(Type.String()),
  stateText: Type.Optional(Type.String()),
});
