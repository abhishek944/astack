import { ImageGenError } from './errors.js';
import {
  MAX_GENERATED_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_INPUTS,
  MAX_TOTAL_REFERENCE_IMAGE_BYTES,
} from './image-input.js';
import type {
  ApiStyle,
  GenerateImageParams,
  ImageComplexity,
  ImageModelCapabilities,
  ImageOutputFormat,
  SvgReasoningEffort,
} from './types.js';

/**
 * Capability-driven description helpers, shared by the tool schema builder
 * (index.ts) and the generate path (generate.ts).
 *
 * Philosophy: the capability contract is ADVICE, not a gate. The documented
 * values are rendered into the tool schema's descriptions so the LLM picks
 * valid values on the first call; anything it still gets wrong is answered
 * by the provider's own error — private deployments and gateways may
 * legitimately diverge from the cloud platform's documented limits, so
 * provider-specific numeric limits (size ranges, n ceilings, and model-level
 * reference counts) are not hard-enforced here. Separate extension-wide input
 * safety ceilings are enforced while resolving images, and pre-flight also
 * rejects parameter combinations OUR adapters would silently drop (see
 * validateGenerateParams).
 */

export const SVG_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies ReadonlyArray<SvgReasoningEffort>;

/** API reference/SDK bounds for `frame_count`. The guide currently says 2–64; this package
 * follows the reference/SDK 2–16 until the official sources agree. */
export const MIN_GIF_FRAMES = 2;
export const MAX_GIF_FRAMES = 16;
/** API reference minimum for `frame_duration_ms`; the API rounds to 10 ms and caps the encoded delay. */
export const MIN_GIF_FRAME_DURATION_MS = 20;

/**
 * Remove model-declared controls that the selected wire adapter cannot carry.
 * This matters for custom providers that deliberately pair a familiar model id
 * with a different API shape.
 */
export function capabilitiesForApi(
  capabilities: ImageModelCapabilities,
  api: ApiStyle,
): ImageModelCapabilities {
  const clean = { ...capabilities };
  if (api === 'gemini') {
    delete clean.sizes;
    delete clean.sizeRange;
  } else {
    if (api !== 'adobe-firefly' && api !== 'stability' && api !== 'recraft') delete clean.aspectRatios;
    delete clean.imageSizes;
  }
  if (api !== 'openai' && api !== 'openrouter' && api !== 'codex') {
    delete clean.qualityValues;
  }
  if (api !== 'openai' && api !== 'openrouter' && api !== 'codex' && api !== 'ark' && api !== 'mai') {
    delete clean.backgroundValues;
  }
  if (api !== 'openrouter' && api !== 'recraft') delete clean.responseFormats;
  if (api !== 'ark') {
    delete clean.supportsLayerDecomposition;
    delete clean.supportsLayerTextRecognition;
    delete clean.layerMaxImages;
    delete clean.layerOutputMax;
  }
  if (api !== 'gemini') {
    delete clean.thinkingLevels;
    delete clean.supportsSearchGrounding;
    delete clean.supportsImageSearchGrounding;
  }
  if (api === 'dashscope' && clean.supportsEnableThinking === undefined && clean.supportsThinking) {
    clean.supportsEnableThinking = true;
  }
  if (api === 'gemini' && clean.supportsThoughtOutput === undefined && clean.supportsThinking) {
    clean.supportsThoughtOutput = true;
  }
  delete clean.supportsThinking;
  if (api !== 'dashscope') {
    delete clean.supportsAsyncMode;
    delete clean.supportsSequentialSets;
    delete clean.sequentialMaxImages;
    delete clean.supportsEnableThinking;
  }
  if (api !== 'gemini') delete clean.supportsThoughtOutput;
  if (api !== 'adobe-firefly') {
    delete clean.resolutionLevels;
    delete clean.promptReasonerValues;
  }
  if (api !== 'recraft') {
    delete clean.operations;
    delete clean.supportsStyleReferences;
    delete clean.styleMatchValues;
    delete clean.supportsTextLayout;
    delete clean.supportsColorControls;
    delete clean.supportsSvgEdits;
    delete clean.supportsSvgVariants;
  }
  if (api !== 'openai') delete clean.supportsSvgAuthor;
  if (api !== 'stability' && api !== 'recraft') delete clean.supportsStrength;
  if (api !== 'openai' && api !== 'openrouter' && api !== 'bfl' && api !== 'stability' && api !== 'recraft') {
    delete clean.outputFormats;
  }
  if (api !== 'openai' && api !== 'openrouter') delete clean.supportsOutputCompression;
  if (api !== 'openai') {
    // Only the OpenAI Images adapter carries the 2.6 controls: native GIF/SVG output,
    // complexity planning and markup edits. Other adapters keep only their verified encodings.
    if (clean.outputFormats) {
      const allowed = api === 'recraft'
        ? ['png', 'jpeg', 'webp', 'svg']
        : ['png', 'jpeg', 'webp'];
      const filtered = clean.outputFormats.filter((format) => allowed.includes(format));
      if (filtered.length) clean.outputFormats = filtered;
      else delete clean.outputFormats;
    }
    delete clean.complexityValues;
    delete clean.supportsMarkup;
  }
  if (
    clean.supportsOutputCompression &&
    !clean.outputFormats?.some((format) => format === 'jpeg' || format === 'webp')
  ) {
    delete clean.supportsOutputCompression;
  }
  if (api !== 'openai' && api !== 'recraft') delete clean.supportsMask;
  if (api !== 'dashscope' && api !== 'openrouter' && api !== 'stability' && api !== 'recraft') {
    delete clean.supportsNegativePrompt;
  }
  if (api !== 'dashscope' && api !== 'openrouter' && api !== 'stability' && api !== 'recraft' && api !== 'bfl' && api !== 'adobe-firefly') {
    delete clean.supportsSeed;
  }
  if (api !== 'dashscope' && api !== 'recraft' && api !== 'bfl') {
    delete clean.supportsPromptEnhance;
  }
  if (api !== 'dashscope' && api !== 'ark') delete clean.supportsWatermark;
  if (api !== 'ark') delete clean.supportsSeries;
  if (api === 'mai' || api === 'bfl' || api === 'adobe-firefly' || api === 'stability') clean.nMax = 1;
  return clean;
}

export function genericCapabilitiesForApi(api: ApiStyle): ImageModelCapabilities {
  return {
    ...(api === 'gemini' ? { aspectRatios: ['auto'] } : {}),
    ...(api === 'openrouter' || api === 'recraft'
      ? { responseFormats: ['b64_json', 'url'] as Array<'b64_json' | 'url'> }
      : {}),
    nMax: api === 'ark' || api === 'meta' || api === 'mai' || api === 'bfl' || api === 'adobe-firefly' || api === 'stability' ? 1 : MAX_GENERATED_IMAGES,
    nMaxSource: 'extension',
    maxReferenceImages: api === 'mai' ? 5 : MAX_REFERENCE_IMAGE_INPUTS,
    inputFormats: api === 'mai' ? ['PNG', 'JPEG'] : ['PNG', 'JPEG', 'GIF', 'WEBP'],
    inputMaxBytes: MAX_IMAGE_BYTES,
    referenceLimitsSource: 'extension',
  };
}

/** Shared pixel-size matcher ("<w>x<h>" or "<w>*<h>") — also used by the DashScope adapter. */
export const SIZE_PIXEL_RE = /^(\d{2,5})\s*[x*]\s*(\d{2,5})$/i;

/** True when the model uses aspectRatio/imageSize instead of a pixel size. */
export function hasAspectRatioKnob(caps: ImageModelCapabilities): boolean {
  return Boolean(caps.aspectRatios?.length);
}

/** True when the schema should expose an `imageSize` enum for this model. */
export function hasImageSizeKnob(caps: ImageModelCapabilities): boolean {
  return hasAspectRatioKnob(caps) && (caps.imageSizes?.length ?? 0) > 1;
}

/** Human-readable ratio bound: 1/8 → "1:8", 3 → "3:1", 2.5 → "2.5:1". */
function formatRatio(value: number): string {
  if (value < 1) {
    const inverse = 1 / value;
    return `1:${Number.isInteger(inverse) ? inverse : inverse.toFixed(1)}`;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)}:1`;
}

/**
 * `size` parameter description for a capability-bearing model. Returns null
 * when the model has no pixel-size knob (Gemini aspect-ratio models) — the
 * schema must hide the param entirely in that case. The documented limits are
 * stated as advice ("documented…"); the provider remains the authority.
 */
export function capabilitySizeDescription(caps: ImageModelCapabilities, exampleSize?: string): string | null {
  if (hasAspectRatioKnob(caps)) return null;
  if (caps.sizes) {
    return `Image size. Documented values: ${caps.sizes.join(', ')}. Omit to use the model default.`;
  }
  const range = caps.sizeRange;
  if (!range) return null;
  const example = exampleSize ?? (range.separator === '*' ? '2048*2048' : '2048x2048');
  const parts = [
    `Image size as "<width>${range.separator}<height>" (e.g. "${example}"). Documented limits: total pixels ${range.minArea}–${range.maxArea}`,
  ];
  if (range.minRatio != null && range.maxRatio != null) {
    parts.push(`width/height ratio ${formatRatio(range.minRatio)}–${formatRatio(range.maxRatio)}`);
  }
  if (range.divisibleBy) parts.push(`dimensions divisible by ${range.divisibleBy}`);
  if (range.maxEdge) parts.push(`longest edge at most ${range.maxEdge}px`);
  if (caps.outputFormats?.includes('gif')) {
    parts.push('for GIF output this describes each frame, and the frames share the model pixel budget');
  }
  let text = `${parts.join('; ')}.`;
  if (range.tiers) {
    text += ` Alternatively a tier token: ${range.tiers.join(', ')} — do not mix the two forms.`;
  }
  if (range.allowAuto) text += ' "auto" lets the model pick.';
  text += ' Out-of-range values are rejected by the provider; omit to use the model default.';
  return text;
}

/**
 * Suffix for the `image` parameter description spelling out the active
 * model's documented reference-image contract (formats, count, byte ceiling,
 * advisory) — advisory text; the provider enforces its own limits.
 */
export function referenceImageDescription(caps: ImageModelCapabilities): string {
  const providerMb = Math.round(caps.inputMaxBytes / (1024 * 1024));
  const localMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
  const subject =
    caps.referenceLimitsSource === 'extension'
      ? 'This extension accepts'
      : 'The active model documents';
  let text = `${subject} up to ${caps.maxReferenceImages} reference image(s) — formats: ${caps.inputFormats.join('/')}; each up to ${providerMb}MB.`;
  const localTotalMb = Math.round(MAX_TOTAL_REFERENCE_IMAGE_BYTES / (1024 * 1024));
  if (caps.maxReferenceImages > MAX_REFERENCE_IMAGE_INPUTS) {
    text += ` This extension enforces a lower ${MAX_REFERENCE_IMAGE_INPUTS}-image safety limit.`;
  }
  if (caps.inputMaxBytes > MAX_IMAGE_BYTES) {
    text += ` This extension enforces a lower ${localMb}MB safety limit per image.`;
  } else if (caps.referenceLimitsSource === 'extension') {
    text += ' The provider may enforce stricter limits.';
  }
  text += ` Combined reference inputs are limited to ${localTotalMb}MB.`;
  if (caps.inputDimAdvice) text += ` ${caps.inputDimAdvice}.`;
  return text;
}

/**
 * Maximum outputs admitted for one provider response. Normal routes keep the
 * package-wide 10-image ceiling; layer decomposition uses the provider's
 * verified cap from the route capabilities, not an invented local number.
 */
export function outputImageLimit(
  params: Pick<GenerateImageParams, 'layerDecomposition' | 'layerMaxImages'>,
  capabilities?: ImageModelCapabilities,
): number {
  if (params.layerDecomposition && capabilities?.supportsLayerDecomposition) {
    const outputMax = capabilities.layerOutputMax ?? capabilities.layerMaxImages?.max;
    if (outputMax != null) {
      return params.layerMaxImages != null ? Math.min(params.layerMaxImages, outputMax) : outputMax;
    }
  }
  if (params.layerDecomposition && params.layerMaxImages != null) return params.layerMaxImages;
  return MAX_GENERATED_IMAGES;
}

/**
 * Pre-flight guards against parameter combinations OUR adapters would
 * silently drop — the provider never sees them, so it cannot be the backstop
 * (a pixel size passed to a Gemini aspect-ratio model, or aspectRatio/
 * imageSize passed to a pixel-size model). Documented numeric limits are
 * deliberately NOT enforced here: they are advice in the schema descriptions,
 * and the provider's own error is the backstop for anything out of range.
 */
export function validateImageCount(params: GenerateImageParams): void {
  if (
    params.n != null &&
    (!Number.isInteger(params.n) || params.n < 1 || params.n > MAX_GENERATED_IMAGES)
  ) {
    throw new ImageGenError(
      `n must be an integer from 1 to ${MAX_GENERATED_IMAGES} (got ${params.n}).`,
      'n invalid',
    );
  }
}

export function validateGenerateParams(
  params: GenerateImageParams,
  caps: ImageModelCapabilities,
  modelId: string,
): void {
  validateImageCount(params);
  if (caps.nMax === 1 && params.n != null && params.n !== 1) {
    throw new ImageGenError(
      `${modelId} generates one image per request and does not accept n greater than 1.`,
      'n unsupported by model',
    );
  }
  if (hasAspectRatioKnob(caps)) {
    if (params.size) {
      throw new ImageGenError(
        `${modelId} has no pixel-size knob — pass aspectRatio${hasImageSizeKnob(caps) ? ' (and optionally imageSize)' : ''} instead of size.`,
        'size unsupported by model',
      );
    }
  } else if (params.aspectRatio || params.imageSize) {
    throw new ImageGenError(
      `${modelId} does not accept aspectRatio/imageSize — use size instead.`,
      'aspect knobs unsupported by model',
    );
  }
  const unsupported: Array<[unknown, boolean | undefined, string]> = [
    [params.outputFormat, Boolean(caps.outputFormats?.length), 'outputFormat'],
    [params.responseFormat, Boolean(caps.responseFormats?.length), 'responseFormat'],
    [params.complexity, Boolean(caps.complexityValues?.length), 'complexity'],
    [params.frameCount, Boolean(caps.outputFormats?.includes('gif')), 'frameCount'],
    [params.frameDurationMs, Boolean(caps.outputFormats?.includes('gif')), 'frameDurationMs'],
    [params.svgModel, caps.supportsSvgAuthor, 'svgModel'],
    [params.svgReasoningEffort, caps.supportsSvgAuthor, 'svgReasoningEffort'],
    [params.markup, caps.supportsMarkup, 'markup'],
    [params.background, Boolean(caps.backgroundValues?.length), 'background'],
    [params.outputCompression, caps.supportsOutputCompression, 'outputCompression'],
    [params.mask, caps.supportsMask, 'mask'],
    [params.negativePrompt, caps.supportsNegativePrompt, 'negativePrompt'],
    [params.seed, caps.supportsSeed, 'seed'],
    [params.promptEnhance, caps.supportsPromptEnhance, 'promptEnhance'],
    [params.enableThinking, caps.supportsEnableThinking, 'enableThinking'],
    [params.thinkingLevel, Boolean(caps.thinkingLevels?.length), 'thinkingLevel'],
    [params.includeThoughts, caps.supportsThoughtOutput, 'includeThoughts'],
    [params.searchGrounding, caps.supportsSearchGrounding, 'searchGrounding'],
    [params.imageSearchGrounding, caps.supportsImageSearchGrounding, 'imageSearchGrounding'],
    [params.asyncMode, caps.supportsAsyncMode, 'asyncMode'],
    [params.sequentialMaxImages, caps.supportsSequentialSets, 'sequentialMaxImages'],
    [params.resolutionLevel, Boolean(caps.resolutionLevels?.length), 'resolutionLevel'],
    [params.promptReasoner, Boolean(caps.promptReasonerValues?.length), 'promptReasoner'],
    [params.strength, caps.supportsStrength, 'strength'],
    [params.operation, Boolean(caps.operations?.length), 'operation'],
    [params.styleId, caps.supportsStyleReferences, 'styleId'],
    [params.styleReferenceUrls, caps.supportsStyleReferences, 'styleReferenceUrls'],
    [params.styleMatch, Boolean(caps.styleMatchValues?.length), 'styleMatch'],
    [params.textLayout, caps.supportsTextLayout, 'textLayout'],
    [params.colorControls, caps.supportsColorControls, 'colorControls'],
    [params.backgroundColor, caps.supportsColorControls, 'backgroundColor'],
    [params.watermark, caps.supportsWatermark, 'watermark'],
    [params.seriesMaxImages, caps.supportsSeries, 'seriesMaxImages'],
    [params.layerDecomposition, caps.supportsLayerDecomposition, 'layerDecomposition'],
    [params.layerTextRecognition, caps.supportsLayerTextRecognition, 'layerTextRecognition'],
  ];
  for (const [value, supported, name] of unsupported) {
    if (value !== undefined && !supported) {
      throw new ImageGenError(`${modelId} does not support ${name}.`, `${name} unsupported by model`);
    }
  }
  if (params.outputFormat && !caps.outputFormats?.includes(params.outputFormat)) {
    throw new ImageGenError(`${modelId} does not support output format ${params.outputFormat}.`, 'outputFormat invalid');
  }
  if (params.responseFormat && !caps.responseFormats?.includes(params.responseFormat)) {
    throw new ImageGenError(`${modelId} does not support response format ${params.responseFormat}.`, 'responseFormat invalid');
  }
  if (params.complexity && !caps.complexityValues?.includes(params.complexity)) {
    throw new ImageGenError(`${modelId} does not support complexity ${params.complexity}.`, 'complexity invalid');
  }
  if (params.thinkingLevel && !caps.thinkingLevels?.includes(params.thinkingLevel)) {
    throw new ImageGenError(`${modelId} does not support thinkingLevel ${params.thinkingLevel}.`, 'thinkingLevel invalid');
  }
  if (params.imageSearchGrounding && params.searchGrounding === false) {
    throw new ImageGenError('imageSearchGrounding requires searchGrounding to remain enabled.', 'image search grounding without search grounding');
  }
  if (params.resolutionLevel && !caps.resolutionLevels?.includes(params.resolutionLevel)) {
    throw new ImageGenError(`${modelId} does not support resolutionLevel ${params.resolutionLevel}.`, 'resolutionLevel invalid');
  }
  if (params.promptReasoner && !caps.promptReasonerValues?.includes(params.promptReasoner)) {
    throw new ImageGenError(`${modelId} does not support promptReasoner ${params.promptReasoner}.`, 'promptReasoner invalid');
  }
  if (params.styleMatch && !caps.styleMatchValues?.includes(params.styleMatch)) {
    throw new ImageGenError(`${modelId} does not support styleMatch ${params.styleMatch}.`, 'styleMatch invalid');
  }
  if (params.operation && !caps.operations?.includes(params.operation)) {
    throw new ImageGenError(`${modelId} does not support operation ${params.operation}.`, 'operation invalid');
  }
  if (params.strength != null && (!Number.isFinite(params.strength) || params.strength < 0 || params.strength > 1)) {
    throw new ImageGenError('strength must be a number from 0 to 1.', 'strength invalid');
  }
  const format = params.outputFormat;
  if (format === 'gif' && params.image && params.image.length > 0) {
    throw new ImageGenError(
      'GIF output is generation-only; the image edit endpoint does not support it.',
      'gif output requires generation',
    );
  }
  if (format === 'svg' && params.image && params.image.length > 0 && !caps.supportsSvgEdits) {
    throw new ImageGenError(
      `${modelId} does not support SVG editing.`,
      'svg editing unsupported',
    );
  }
  if (format === 'svg' && (params.n ?? 1) !== 1 && !caps.supportsSvgVariants) {
    throw new ImageGenError('SVG output requires n to be 1 for this model.', 'svg requires n=1');
  }
  if (params.frameCount != null) {
    if (format !== 'gif') {
      throw new ImageGenError('frameCount requires an explicit gif outputFormat.', 'frameCount requires gif');
    }
    if (!Number.isInteger(params.frameCount) || params.frameCount < MIN_GIF_FRAMES || params.frameCount > MAX_GIF_FRAMES) {
      throw new ImageGenError(
        `frameCount must be an integer from ${MIN_GIF_FRAMES} to ${MAX_GIF_FRAMES}.`,
        'frameCount invalid',
      );
    }
  }
  if (params.frameDurationMs != null) {
    if (format !== 'gif') {
      throw new ImageGenError('frameDurationMs requires an explicit gif outputFormat.', 'frameDurationMs requires gif');
    }
    if (!Number.isInteger(params.frameDurationMs) || params.frameDurationMs < MIN_GIF_FRAME_DURATION_MS) {
      throw new ImageGenError(
        `frameDurationMs must be an integer of at least ${MIN_GIF_FRAME_DURATION_MS} milliseconds.`,
        'frameDurationMs invalid',
      );
    }
  }
  if (params.svgModel !== undefined && !params.svgModel.trim()) {
    throw new ImageGenError('svgModel must be a non-empty model id.', 'svgModel invalid');
  }
  if (params.svgModel && format !== 'svg') {
    throw new ImageGenError('svgModel requires an explicit svg outputFormat.', 'svgModel requires svg');
  }
  if (params.svgReasoningEffort && !params.svgModel) {
    throw new ImageGenError(
      'svgReasoningEffort requires svgModel; omit both when SVG model selection is disabled, or supply the author model.',
      'svgReasoningEffort requires svgModel',
    );
  }
  if (params.svgReasoningEffort && format !== 'svg') {
    throw new ImageGenError('svgReasoningEffort requires an explicit svg outputFormat.', 'svgReasoningEffort requires svg');
  }
  if (params.background && !caps.backgroundValues?.includes(params.background)) {
    throw new ImageGenError(`${modelId} does not support background ${params.background}.`, 'background invalid');
  }
  if (params.outputCompression != null && (!Number.isInteger(params.outputCompression) || params.outputCompression < 0 || params.outputCompression > 100)) {
    throw new ImageGenError('outputCompression must be an integer from 0 to 100.', 'outputCompression invalid');
  }
  if (params.outputCompression != null && (format === 'gif' || format === 'svg')) {
    throw new ImageGenError('GIF and SVG output do not support outputCompression.', 'outputCompression unsupported for format');
  }
  if (params.outputCompression != null && params.outputFormat !== 'jpeg' && params.outputFormat !== 'webp') {
    throw new ImageGenError('outputCompression requires an explicit jpeg or webp outputFormat.', 'outputCompression requires compressed format');
  }
  if (params.background === 'transparent' && params.outputFormat && params.outputFormat !== 'png' && params.outputFormat !== 'webp') {
    throw new ImageGenError('Transparent backgrounds require png or webp outputFormat.', 'transparent format unsupported');
  }
  if (params.mask && params.markup) {
    throw new ImageGenError('markup cannot be combined with mask.', 'markup with mask');
  }
  if (params.markup && (!params.image || params.image.length === 0)) {
    throw new ImageGenError('markup requires at least one edit target in image.', 'markup without edit target');
  }
  if (params.mask && (!params.image || params.image.length === 0)) {
    throw new ImageGenError('mask requires at least one edit target in image.', 'mask without edit target');
  }
  if (params.seed != null && (!Number.isSafeInteger(params.seed) || params.seed < 0 || params.seed > 2_147_483_647)) {
    throw new ImageGenError('seed must be an integer from 0 to 2147483647.', 'seed invalid');
  }
  if (params.sequentialMaxImages != null) {
    const bounds = caps.sequentialMaxImages;
    if (!bounds || !Number.isInteger(params.sequentialMaxImages) ||
        params.sequentialMaxImages < bounds.min || params.sequentialMaxImages > bounds.max) {
      throw new ImageGenError(
        bounds
          ? `sequentialMaxImages must be an integer from ${bounds.min} to ${bounds.max}.`
          : `${modelId} does not support sequentialMaxImages.`,
        'sequentialMaxImages invalid',
      );
    }
  }
  if (params.operation && params.operation !== 'generate' && (!params.image || params.image.length === 0)) {
    throw new ImageGenError(`${params.operation} requires at least one input image.`, 'operation needs image');
  }
  if ((params.operation === 'inpaint' || params.operation === 'generateBackground' || params.operation === 'eraseRegion') && !params.mask) {
    throw new ImageGenError(`${params.operation} requires a mask image.`, 'operation needs mask');
  }
  if (params.enableThinking === true && params.promptEnhance === false) {
    throw new ImageGenError('enableThinking requires promptEnhance to remain enabled.', 'thinking requires prompt enhancement');
  }
  if (params.seriesMaxImages != null && (!Number.isInteger(params.seriesMaxImages) || params.seriesMaxImages < 1 || params.seriesMaxImages > MAX_GENERATED_IMAGES)) {
    throw new ImageGenError(`seriesMaxImages must be an integer from 1 to ${MAX_GENERATED_IMAGES}.`, 'seriesMaxImages invalid');
  }
  if (params.layerDecomposition && (!params.image || params.image.length !== 1)) {
    throw new ImageGenError('layerDecomposition requires exactly one input image.', 'layer decomposition needs one image');
  }
  if (params.layerDecomposition && params.background !== undefined) {
    throw new ImageGenError('layerDecomposition cannot be combined with background.', 'layer decomposition with background');
  }
  if ((params.layerMaxImages !== undefined || params.layerTextRecognition !== undefined) && !params.layerDecomposition) {
    throw new ImageGenError('Layer options require layerDecomposition.', 'layer options without decomposition');
  }
  if (params.layerMaxImages !== undefined) {
    const bounds = caps.layerMaxImages;
    if (!bounds || !Number.isInteger(params.layerMaxImages) ||
        params.layerMaxImages < bounds.min || params.layerMaxImages > bounds.max) {
      throw new ImageGenError(
        bounds
          ? `layerMaxImages must be an integer from ${bounds.min} to ${bounds.max}.`
          : `${modelId} does not support layerMaxImages.`,
        'layerMaxImages invalid',
      );
    }
  }
}

/**
 * Shape-check a user-supplied capability declaration (customProviders model
 * entry). Invalid fields are dropped with a stderr warning rather than
 * flowing into the tool schema and validators — settings are a trust boundary
 * (CLAUDE.md), and pi-video-gen enforces the same at settings load. Returns a
 * clean Partial; valid fields pass through untouched.
 */
export function sanitizeCapabilities(
  explicit: Partial<ImageModelCapabilities>,
  _owner: string,
): Partial<ImageModelCapabilities> {
  const clean: Partial<ImageModelCapabilities> = {};
  const drop = (key: string, value: unknown, rule: string) => {
    const shape = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    // Never echo a custom provider/model id or malformed setting value: either
    // could contain a misplaced credential.
    console.error(
      `[pi-image-gen] ignoring invalid capabilities.${key} in a custom model declaration: expected ${rule}; received ${shape}`,
    );
  };
  const stringArray = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((s) => typeof s === 'string' && s.length > 0) &&
    new Set(v).size === v.length;

  for (const [key, value] of Object.entries(explicit)) {
    if (value === undefined) continue;
    switch (key) {
      case 'nMax':
        if (
          Number.isInteger(value) &&
          (value as number) >= 1 &&
          (value as number) <= MAX_GENERATED_IMAGES
        ) {
          clean.nMax = value as number;
        } else {
          drop(key, value, `an integer from 1 to ${MAX_GENERATED_IMAGES}`);
        }
        break;
      case 'nMaxSource':
        if (value === 'provider' || value === 'extension') clean.nMaxSource = value;
        else drop(key, value, '"provider" or "extension"');
        break;
      case 'maxReferenceImages':
        if (Number.isInteger(value) && (value as number) >= 0)
          clean.maxReferenceImages = value as number;
        else drop(key, value, 'an integer ≥ 0');
        break;
      case 'inputMaxBytes':
        if (typeof value === 'number' && Number.isFinite(value) && value > 0)
          clean.inputMaxBytes = value;
        else drop(key, value, 'a positive number');
        break;
      case 'inputFormats':
        if (stringArray(value)) clean.inputFormats = value;
        else drop(key, value, 'an array of format labels');
        break;
      case 'sizes':
        if (stringArray(value)) clean.sizes = value;
        else drop(key, value, 'an array of size strings');
        break;
      case 'aspectRatios':
        if (stringArray(value)) clean.aspectRatios = value;
        else drop(key, value, 'an array of aspect ratios');
        break;
      case 'imageSizes':
        if (stringArray(value)) clean.imageSizes = value;
        else drop(key, value, 'an array of size tiers');
        break;
      case 'qualityValues':
        if (stringArray(value)) clean.qualityValues = value;
        else drop(key, value, 'an array of quality values');
        break;
      case 'outputFormats':
        if (stringArray(value) && value.every((v) => v === 'png' || v === 'jpeg' || v === 'webp' || v === 'gif' || v === 'svg'))
          clean.outputFormats = value as ImageOutputFormat[];
        else drop(key, value, 'an array containing png, jpeg, webp, gif, or svg');
        break;
      case 'complexityValues':
        if (stringArray(value) && value.every((v) => v === 'low' || v === 'medium' || v === 'high'))
          clean.complexityValues = value as ImageComplexity[];
        else drop(key, value, 'an array containing low, medium, or high');
        break;
      case 'backgroundValues':
        if (stringArray(value) && value.every((v) => v === 'auto' || v === 'transparent' || v === 'opaque')) clean.backgroundValues = value as Array<'auto' | 'transparent' | 'opaque'>;
        else drop(key, value, 'an array containing auto, transparent, or opaque');
        break;
      case 'responseFormats':
        if (stringArray(value) && value.every((v) => v === 'b64_json' || v === 'url')) clean.responseFormats = value as Array<'b64_json' | 'url'>;
        else drop(key, value, 'an array containing b64_json or url');
        break;
      case 'supportsOutputCompression':
      case 'supportsMask':
      case 'supportsMarkup':
      case 'supportsNegativePrompt':
      case 'supportsSeed':
      case 'supportsPromptEnhance':
      case 'supportsThinking':
      case 'supportsWatermark':
      case 'supportsSeries':
      case 'supportsLayerDecomposition':
      case 'supportsLayerTextRecognition':
      case 'supportsSearchGrounding':
      case 'supportsImageSearchGrounding':
      case 'supportsAsyncMode':
      case 'supportsSequentialSets':
      case 'supportsStrength':
      case 'supportsStyleReferences':
      case 'supportsTextLayout':
      case 'supportsColorControls':
      case 'supportsEnableThinking':
      case 'supportsThoughtOutput':
      case 'supportsSvgEdits':
      case 'supportsSvgVariants':
      case 'supportsSvgAuthor':
        if (typeof value === 'boolean') (clean as Record<string, unknown>)[key] = value;
        else drop(key, value, 'a boolean');
        break;
      case 'layerMaxImages': {
        const bounds = value as { min?: unknown; max?: unknown } | null;
        if (bounds && typeof bounds === 'object' &&
            Number.isInteger(bounds.min) && (bounds.min as number) >= 1 &&
            Number.isInteger(bounds.max) && (bounds.max as number) >= (bounds.min as number)) {
          clean.layerMaxImages = { min: bounds.min as number, max: bounds.max as number };
        } else drop(key, value, 'an object with integer min and max layer counts');
        break;
      }
      case 'layerOutputMax':
        if (Number.isInteger(value) && (value as number) >= 1) clean.layerOutputMax = value as number;
        else drop(key, value, 'a positive integer');
        break;
      case 'thinkingLevels':
        if (stringArray(value) && value.every((v) => v === 'minimal' || v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh')) {
          clean.thinkingLevels = value as Array<'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>;
        } else drop(key, value, 'an array of Gemini thinking levels');
        break;
      case 'resolutionLevels':
        if (stringArray(value)) clean.resolutionLevels = value;
        else drop(key, value, 'an array of resolution levels');
        break;
      case 'promptReasonerValues':
        if (stringArray(value) && value.every((v) => v === 'speed' || v === 'quality')) {
          clean.promptReasonerValues = value as Array<'speed' | 'quality'>;
        } else drop(key, value, 'an array containing speed or quality');
        break;
      case 'operations':
        if (stringArray(value)) clean.operations = value as NonNullable<ImageModelCapabilities['operations']>;
        else drop(key, value, 'an array of operation names');
        break;
      case 'styleMatchValues':
        if (stringArray(value)) clean.styleMatchValues = value;
        else drop(key, value, 'an array of style match modes');
        break;
      case 'sequentialMaxImages': {
        const bounds = value as { min?: unknown; max?: unknown } | null;
        if (bounds && typeof bounds === 'object' && Number.isInteger(bounds.min) && (bounds.min as number) >= 1 &&
            Number.isInteger(bounds.max) && (bounds.max as number) >= (bounds.min as number)) {
          clean.sequentialMaxImages = { min: bounds.min as number, max: bounds.max as number };
        } else drop(key, value, 'an object with integer min and max image counts');
        break;
      }
      case 'referenceLimitsSource':
        if (value === 'provider' || value === 'extension') clean.referenceLimitsSource = value;
        else drop(key, value, '"provider" or "extension"');
        break;
      case 'inputDimAdvice':
        if (typeof value === 'string' && value.length > 0) clean.inputDimAdvice = value;
        else drop(key, value, 'a non-empty string');
        break;
      case 'sizeRange': {
        const range = sanitizeSizeRange(value, key, drop);
        if (range) clean.sizeRange = range;
        break;
      }
      default:
        drop(key, value, 'a known capabilities field');
    }
  }
  return clean;
}

function sanitizeSizeRange(
  value: unknown,
  key: string,
  drop: (key: string, value: unknown, rule: string) => void,
): ImageModelCapabilities['sizeRange'] | undefined {
  if (typeof value !== 'object' || value === null) {
    drop(key, value, 'a sizeRange object');
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const separator = raw.separator === 'x' || raw.separator === '*' ? raw.separator : undefined;
  const minArea = typeof raw.minArea === 'number' && raw.minArea > 0 ? raw.minArea : undefined;
  const maxArea = typeof raw.maxArea === 'number' && raw.maxArea > 0 ? raw.maxArea : undefined;
  if (!separator || minArea == null || maxArea == null || maxArea <= minArea) {
    console.error(
      '[pi-image-gen] ignoring invalid capabilities.sizeRange in a custom model declaration: separator must be "x" or "*" and 0 < minArea < maxArea',
    );
    return undefined;
  }
  const range: NonNullable<ImageModelCapabilities['sizeRange']> = { separator, minArea, maxArea };
  if (typeof raw.minRatio === 'number' || typeof raw.maxRatio === 'number') {
    // The ratio pair is checked like the area pair: an inverted pair would
    // otherwise pass the shape check and make validateSize reject everything.
    if (
      typeof raw.minRatio === 'number' &&
      typeof raw.maxRatio === 'number' &&
      raw.minRatio > 0 &&
      raw.maxRatio > raw.minRatio
    ) {
      range.minRatio = raw.minRatio;
      range.maxRatio = raw.maxRatio;
    } else {
      console.error(
        '[pi-image-gen] ignoring capabilities.sizeRange ratio bounds in a custom model declaration: expected 0 < minRatio < maxRatio',
      );
    }
  }
  if (Array.isArray(raw.tiers) && raw.tiers.every((t) => typeof t === 'string' && t.length > 0)) {
    range.tiers = raw.tiers as string[];
  }
  if (raw.allowAuto === true) range.allowAuto = true;
  if (typeof raw.divisibleBy === 'number' && raw.divisibleBy > 0)
    range.divisibleBy = raw.divisibleBy;
  if (typeof raw.maxEdge === 'number' && raw.maxEdge > 0) range.maxEdge = raw.maxEdge;
  return range;
}
