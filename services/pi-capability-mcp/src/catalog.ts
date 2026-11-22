import {
  classifyParameters,
  classifyTreeParameters,
} from "@abhishek944/pi-classifier/extension";
import { normalizeSpriteSettings } from "@abhishek944/pi-image-gen";
import {
  buildImageToolParameters,
  buildSpriteToolParameters,
  resolveImageToolCapabilities,
} from "@abhishek944/pi-image-gen/extension";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Type, type TSchema } from "typebox";
import type { ServiceConfig } from "./config.js";

export type CapabilityFamily = "image" | "web" | "classifier";

export interface CapabilityTool {
  readonly name: string;
  readonly family: CapabilityFamily;
  readonly description: string;
  readonly inputSchema: TSchema;
  readonly paid: boolean;
  readonly annotations: Record<string, unknown>;
}

export type CapabilityExecutor = (
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
) => Promise<CallToolResult>;

export interface CapabilityAdapters {
  readonly tools: readonly CapabilityTool[];
  readonly executors: Readonly<Record<string, CapabilityExecutor>>;
  close?(): Promise<void>;
}

const idempotencyProperty = {
  type: "string",
  minLength: 1,
  description: "Caller-owned key. Paid calls with the same key and input reuse the first job; a different input with the same key is rejected.",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Add the idempotency key to the root object schema. MCP requires
 * `inputSchema.type === "object"`; a TypeBox intersection emits only `allOf`
 * and closed object branches reject the sibling key.
 */
export function paidSchema(schema: TSchema): TSchema {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties)) {
    throw new Error("Paid capability schemas must be root object schemas");
  }
  const properties: Record<string, unknown> = { ...schema.properties };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  properties.idempotencyKey = idempotencyProperty;
  return {
    ...schema,
    properties,
    required: required.includes("idempotencyKey") ? required : [...required, "idempotencyKey"],
  } as TSchema;
}

export function capabilityTool(input: {
  name: string;
  family: CapabilityFamily;
  description: string;
  inputSchema: TSchema;
  paid: boolean;
  annotations?: Record<string, unknown>;
}): CapabilityTool {
  return {
    name: input.name,
    family: input.family,
    description: input.description,
    inputSchema: input.paid ? paidSchema(input.inputSchema) : input.inputSchema,
    paid: input.paid,
    annotations: input.annotations ?? {},
  };
}

const paidNetwork = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const capabilityInfoSchema = Type.Object({}, { additionalProperties: false });

const imageCompareSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1, description: "The same prompt for every configured comparison entry." }),
    image: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    filename: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const imageSearchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 200, description: "Existing-image search query, at most 50 words." }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum candidates per provider; default 5." })),
    expectedProvider: Type.Optional(Type.String({ minLength: 1, description: "Fail if the server provider differs; never routes the request." })),
    includeBytes: Type.Optional(Type.Boolean({ description: "Return validated downloaded bytes for a server-to-server consumer; never writes outside the server directory." })),
  },
  { additionalProperties: false },
);

const completionPartSchema = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() }, { additionalProperties: false }),
]);

const completionMessageSchema = Type.Union([
  Type.Object({ role: Type.Literal("system"), content: Type.String() }, { additionalProperties: false }),
  Type.Object(
    {
      role: Type.Literal("user"),
      content: Type.Union([Type.String(), Type.Array(completionPartSchema, { minItems: 1 })]),
    },
    { additionalProperties: false },
  ),
]);

const completionSchema = Type.Object(
  {
    messages: Type.Array(completionMessageSchema, { minItems: 1 }),
    attribution: Type.Object(
      {
        customer: Type.String({ minLength: 1 }),
        tags: Type.Array(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
    expectedModel: Type.Optional(Type.String({ minLength: 1, description: "Fail if the server model differs; never routes the request." })),
  },
  { additionalProperties: false },
);

/** Build the static image and classifier catalog from the owning packages' contracts. */
export function createStaticTools(config: ServiceConfig): CapabilityTool[] {
  const imageCaps = resolveImageToolCapabilities(config.imageSettings);
  const tools: CapabilityTool[] = [];

  if (config.completionSettings !== undefined) {
    tools.push(capabilityTool({
      name: "capability_info",
      family: "image",
      description: "Describe the server-owned completion model without making a paid call.",
      inputSchema: capabilityInfoSchema,
      paid: false,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }));
    tools.push(capabilityTool({
      name: "model_complete",
      family: "image",
      description: "Complete a server-configured text or vision prompt with measured usage. Provider, model and credentials stay on the server.",
      inputSchema: completionSchema,
      paid: true,
      annotations: paidNetwork,
    }));
  }

  tools.push(
    capabilityTool({
      name: "image_generate",
      family: "image",
      description: "Generate or edit images with the server-configured pi-image-gen route. Credentials, provider and model are server-owned.",
      inputSchema: buildImageToolParameters(imageCaps),
      paid: true,
      annotations: paidNetwork,
    }),
    capabilityTool({
      name: "image_compare",
      family: "image",
      description: "Explicitly compare configured image models. Every entry may be billed separately.",
      inputSchema: imageCompareSchema,
      paid: true,
      annotations: paidNetwork,
    }),
    capabilityTool({
      name: "image_search",
      family: "image",
      description: "Find and validate existing images with the server-configured pi-image-search route.",
      inputSchema: imageSearchSchema,
      paid: true,
      annotations: paidNetwork,
    }),
    capabilityTool({
      name: "image_search_compare",
      family: "image",
      description: "Explicitly compare configured image-search providers. Each provider may be billed.",
      inputSchema: imageSearchSchema,
      paid: true,
      annotations: paidNetwork,
    }),
    capabilityTool({
      name: "classify",
      family: "classifier",
      description: "Answer typed questions about supplied state with the server-configured classifier route.",
      inputSchema: classifyParameters,
      paid: true,
      annotations: paidNetwork,
    }),
    capabilityTool({
      name: "classify_compare",
      family: "classifier",
      description: "Explicitly compare configured classifier routes. Each entry may be billed separately.",
      inputSchema: classifyParameters,
      paid: true,
      annotations: paidNetwork,
    }),
    capabilityTool({
      name: "classify_tree",
      family: "classifier",
      description: "Classify through a supplied tree using the server-configured classifier route.",
      inputSchema: classifyTreeParameters,
      paid: true,
      annotations: paidNetwork,
    }),
  );

  if (normalizeSpriteSettings(config.imageSettings.spriteGeneration).enabled) {
    tools.unshift(capabilityTool({
      name: "sprite_generate",
      family: "image",
      description: "Generate one coherent sprite sheet with the server-configured pi-image-gen route. Enabled by server settings.",
      inputSchema: buildSpriteToolParameters(imageCaps),
      paid: true,
      annotations: paidNetwork,
    }));
  }
  return tools;
}

export function omitIdempotencyKey(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== "idempotencyKey") result[key] = value;
  }
  return result;
}
