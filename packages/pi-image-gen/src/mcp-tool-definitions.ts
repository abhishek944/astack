// MCP-only tool definitions for the standalone stdio server. These are kept
// independent from the Pi extension's provider-facing definitions: the MCP
// process must not need Pi runtime packages, and provider-native controls are
// validated by the owning package's core functions rather than duplicated here.

import { Type, type TObject } from 'typebox';
import { Value } from 'typebox/value';
import { MAX_GENERATED_IMAGES, MAX_REFERENCE_IMAGE_INPUTS } from './image-input.js';
import { imageResizeSchema } from './resize-schema.js';
import { HARD_MAX_SPRITE_FRAMES } from './sprite/settings.js';

export type ImageMcpToolName =
  | 'image_generate'
  | 'image_compare'
  | 'image_search'
  | 'image_search_compare'
  | 'sprite_generate';

export interface ImageMcpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface ImageMcpToolDefinition {
  name: ImageMcpToolName;
  description: string;
  inputSchema: TObject;
  annotations: ImageMcpToolAnnotations;
}

function stringEnum(values: readonly string[], description?: string) {
  return Type.Unsafe<string>({
    type: 'string',
    enum: [...values],
    ...(description ? { description } : {}),
  });
}

const paidNetwork: ImageMcpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

const imageGenerateDescription =
  'Generate or edit images with the server-configured pi-image-gen route. Provider, model, fallback routes and credentials stay with the server. Reference images and outputDir resolve against the MCP process cwd; provider-native controls beyond the advertised common fields are validated by pi-image-gen. This may incur provider charges. Use image_compare only for an explicit comparison.';

const imageCompareDescription =
  'Explicitly compare configured image models. Every configured entry is a separate request and may incur charges. Never changes the default or accepts arbitrary providers.';

const imageSearchDescription =
  'Find and download existing images with the independently configured pi-image-search routes. Validates local files and returns source/license metadata; no generation. Downloads may incur provider charges.';

const imageSearchCompareDescription =
  'Explicitly compare configured image-search providers. Each configured provider may incur charges. Do not use this to recover from an ordinary empty search.';

const spriteDescription =
  'Generate one coherent sprite sheet from the configured image route, then split, align, validate and encode it locally. Enabled only when server settings enable sprite generation. One call makes one image-generation request and may incur charges.';

const generateProperties = {
  prompt: Type.String({
    minLength: 1,
    description: 'Text prompt describing what to generate or how to edit.',
  }),
  image: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      maxItems: MAX_REFERENCE_IMAGE_INPUTS,
      description:
        'Reference image paths or public HTTP(S) URLs. Local paths resolve against the MCP process cwd; symlinks, base64 and data URIs are rejected.',
    }),
  ),
  n: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_GENERATED_IMAGES,
      description: `Variants of one prompt (existing extension ceiling ${MAX_GENERATED_IMAGES}); provider ceilings may be stricter.`,
    }),
  ),
  size: Type.Optional(Type.String({ description: 'Provider-specific size hint such as "1024x1024".' })),
  aspectRatio: Type.Optional(Type.String({ description: 'Provider-specific aspect ratio such as "1:1".' })),
  imageSize: Type.Optional(Type.String({ description: 'Provider-specific resolution tier for models that expose one.' })),
  quality: Type.Optional(Type.String({ description: 'Quality vocabulary for the active model.' })),
  outputFormat: Type.Optional(Type.String({ description: 'Output encoding advertised by the active model.' })),
  background: Type.Optional(Type.String({ description: 'Background behavior advertised by the active model.' })),
  resize: Type.Optional(imageResizeSchema()),
  filename: Type.Optional(Type.String({ description: 'Output filename prefix without extension.' })),
  outputDir: Type.Optional(Type.String({ minLength: 1, description: 'Output directory relative to the MCP process cwd.' })),
};

const compareProperties = {
  prompt: generateProperties.prompt,
  image: generateProperties.image,
  filename: generateProperties.filename,
  outputDir: generateProperties.outputDir,
};

const searchProperties = {
  query: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Existing-image search query of at most 50 words. Not a generation prompt.',
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 20,
      description: 'Maximum candidates per configured provider; existing default 5.',
    }),
  ),
  resize: Type.Optional(imageResizeSchema()),
  outputDir: Type.Optional(Type.String({ minLength: 1, description: 'Download directory relative to the MCP process cwd.' })),
};

const spriteProperties = {
  prompt: Type.String({ minLength: 1, description: 'Identity, style and one action to render as a coherent sprite sequence.' }),
  image: generateProperties.image,
  assetType: Type.Optional(stringEnum(['player', 'npc', 'creature', 'character', 'prop', 'spell', 'projectile', 'impact', 'fx'])),
  action: Type.Optional(stringEnum(['single', 'idle', 'walk', 'run', 'cast', 'attack', 'shoot', 'jump', 'hurt', 'hover', 'charge', 'explode', 'death'])),
  view: Type.Optional(stringEnum(['topdown', 'side', 'three-quarter'])),
  rows: Type.Optional(Type.Integer({ minimum: 1, maximum: HARD_MAX_SPRITE_FRAMES })),
  columns: Type.Optional(Type.Integer({ minimum: 1, maximum: HARD_MAX_SPRITE_FRAMES })),
  frameCount: Type.Optional(Type.Integer({ minimum: 1, maximum: HARD_MAX_SPRITE_FRAMES, description: 'Must equal rows × columns.' })),
  align: Type.Optional(stringEnum(['center', 'bottom', 'feet'])),
  scaleStrategy: Type.Optional(stringEnum(['fit', 'preserve'])),
  componentMode: Type.Optional(stringEnum(['largest', 'all'])),
  format: Type.Optional(stringEnum(['png', 'apng', 'webp', 'frames'])),
  frameDurationMs: Type.Optional(Type.Integer({ minimum: 20, maximum: 10_000 })),
  strictValidation: Type.Optional(Type.Boolean()),
  size: Type.Optional(Type.String({ description: 'Provider-supported sheet size.' })),
  aspectRatio: Type.Optional(Type.String({ description: 'Provider-supported sheet aspect ratio.' })),
  imageSize: Type.Optional(Type.String({ description: 'Provider-supported output resolution tier.' })),
  quality: Type.Optional(Type.String({ description: 'Quality vocabulary for the active model.' })),
  filename: Type.Optional(Type.String({ description: 'Run-directory name prefix.' })),
  outputDir: Type.Optional(Type.String({ minLength: 1, description: 'Sprite output root relative to the MCP process cwd.' })),
};

/** Build the MCP catalog from the package-owned capability flags, not from Pi runtime state. */
export function buildImageMcpToolDefinitions(includeSprite: boolean): readonly ImageMcpToolDefinition[] {
  const tools: ImageMcpToolDefinition[] = [
    {
      name: 'image_generate',
      description: imageGenerateDescription,
      inputSchema: Type.Object(generateProperties, { additionalProperties: true }),
      annotations: paidNetwork,
    },
    {
      name: 'image_compare',
      description: imageCompareDescription,
      inputSchema: Type.Object(compareProperties, { additionalProperties: false }),
      annotations: paidNetwork,
    },
    {
      name: 'image_search',
      description: imageSearchDescription,
      inputSchema: Type.Object(searchProperties, { additionalProperties: false }),
      annotations: paidNetwork,
    },
    {
      name: 'image_search_compare',
      description: imageSearchCompareDescription,
      inputSchema: Type.Object(searchProperties, { additionalProperties: false }),
      annotations: paidNetwork,
    },
  ];
  if (includeSprite) {
    tools.push({
      name: 'sprite_generate',
      description: spriteDescription,
      inputSchema: Type.Object(spriteProperties, { additionalProperties: false }),
      annotations: paidNetwork,
    });
  }
  return tools;
}

/** Return human-readable validation problems; an empty array means the arguments are valid. */
export function validateMcpToolArguments(tool: ImageMcpToolDefinition, args: unknown): string[] {
  if (Value.Check(tool.inputSchema, args)) return [];
  const problems = new Set<string>();
  for (const error of Value.Errors(tool.inputSchema, args)) {
    if (error.keyword === 'boolean') continue;
    const path = error.instancePath || 'arguments';
    const unknown = error.keyword === 'additionalProperties'
      ? (error.params as { additionalProperties?: string[] }).additionalProperties
      : undefined;
    problems.add(unknown?.length ? `${path}: unknown properties ${unknown.join(', ')}` : `${path}: ${error.message}`);
  }
  return problems.size > 0 ? [...problems] : ['arguments do not match the input schema'];
}

export function isImageMcpToolName(value: string, tools: readonly ImageMcpToolDefinition[]): value is ImageMcpToolName {
  return tools.some((tool) => tool.name === value);
}
