import type { ApiStyle, BuiltInProviderId, ImageModelCapabilities } from './types.js';

export type ModelLifecycle = {
  status: 'deprecated' | 'retiring' | 'preview';
  /** ISO shutdown/retirement date when the provider publishes one. */
  effective?: string;
  replacement?: string;
  /** Official provider page that supplied the status. */
  source: string;
};

/**
 * Built-in known image models. Maps a model id (or alias) to its built-in
 * provider. Custom providers may add or override entries via settings.
 */
export type BuiltInModelEntry = {
  id: string;
  aliases?: string[];
  provider: BuiltInProviderId;
  /** Remote model id sent to the provider (defaults to id). */
  remoteId?: string;
  /** Provider-published lifecycle status; existing configs stay resolvable. */
  lifecycle?: ModelLifecycle;
  /**
   * The model's capability contract — drives the tool schema (which params
   * exist, their enums/patterns) and pre-flight validation before any paid
   * call. Every built-in entry must declare one (enforced by the registry
   * test); custom models may inherit it by id (see config.ts).
   */
  capabilities?: ImageModelCapabilities;
};

// Format vocabularies shared by several entries (display labels; the input
// layer maps sniffed MIME types onto these, see image-input.ts).
const QWEN_INPUT_FORMATS = ['JPG', 'JPEG', 'PNG', 'BMP', 'TIFF', 'WEBP', 'GIF'];
const SEEDREAM_INPUT_FORMATS = ['JPEG', 'PNG', 'WEBP', 'BMP', 'TIFF', 'GIF', 'HEIC', 'HEIF'];
const GEMINI_INPUT_FORMATS = ['PNG', 'JPEG', 'WEBP', 'HEIC', 'HEIF'];
const META_INPUT_FORMATS = ['PNG', 'JPEG', 'GIF', 'WEBP', 'BMP', 'TIFF', 'HEIC', 'HEIF'];

// Contract fragments shared by sibling entries.
const SEEDREAM_DIM_ADVICE =
  'reference images: each dimension > 14 px, aspect ratio 1/16–16, total pixels ≤ 6000x6000';
const QWEN3_SIZE_RANGE: NonNullable<ImageModelCapabilities['sizeRange']> = {
  // 3.0 adds a hard 1:8–8:1 aspect-ratio cap; size omitted = model picks.
  separator: '*',
  minArea: 512 * 512,
  maxArea: 2048 * 2048,
  minRatio: 1 / 8,
  maxRatio: 8,
};

const MB = 1024 * 1024;

// Gemini aspect-ratio vocabularies per https://ai.google.dev/gemini-api/docs/image-generation
// (2026-08): the classic 10, and the 3.1 set adding extreme ratios.
const GEMINI_ASPECTS_10 = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const GEMINI_ASPECTS_14 = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
];
const RECRAFT_1K_SIZES = [
  '1024x1024', '1536x768', '768x1536', '1280x832', '832x1280', '1216x896', '896x1216',
  '1152x896', '896x1152', '832x1344', '1280x896', '896x1280', '1344x768', '768x1344',
];
const RECRAFT_2K_SIZES = [
  '2048x2048', '3072x1536', '1536x3072', '2560x1664', '1664x2560', '2432x1792', '1792x2432',
  '2304x1792', '1792x2304', '1664x2688', '2560x1792', '1792x2560', '2688x1536', '1536x2688',
];
const RECRAFT_LEGACY_SIZES = [
  '1024x1024', '2048x1024', '1024x2048', '1536x1024', '1024x1536', '1365x1024', '1024x1365',
  '1280x1024', '1024x1280', '1024x1707', '1434x1024', '1024x1434', '1820x1024', '1024x1820',
];
const RECRAFT_RATIOS = ['1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '6:10', '14:10', '10:14', '16:9', '9:16'];
const STABILITY_RATIOS = ['21:9', '16:9', '3:2', '5:4', '1:1', '4:5', '2:3', '9:16', '9:21'];

/**
 * Capability values reflect official provider docs reviewed 2026-11-20; each
 * family's source URLs are cited beside its entries. No live generation calls
 * were made:
 * - gpt-image-2: https://developers.openai.com/api/docs/guides/image-generation
 * - Gemini: https://ai.google.dev/gemini-api/docs/image-generation
 * - Qwen 3.0: https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference
 * - Qwen 2.0: https://help.aliyun.com/zh/model-studio/qwen-image-api (+ qwen-image-edit-api)
 * - Seedream: https://www.volcengine.com/docs/82379/1824121 (+ /1666946)
 */
export const BUILT_IN_MODELS: BuiltInModelEntry[] = [
  // ChatGPT-backed Codex Images. This is intentionally a distinct model alias:
  // selecting it opts into subscription usage instead of silently replacing
  // OpenAI developer-API billing when OPENAI_API_KEY is absent.
  {
    id: 'gpt-image-2-codex',
    aliases: ['codex', 'openai-codex'],
    provider: 'codex',
    remoteId: 'gpt-image-2',
    capabilities: {
      sizes: ['auto', '1024x1024', '1536x1024', '1024x1536'],
      qualityValues: ['low', 'medium', 'high', 'auto'],
      backgroundValues: ['auto', 'transparent', 'opaque'],
      nMax: 1,
      maxReferenceImages: 5,
      inputFormats: ['PNG', 'WEBP', 'JPEG'],
      inputMaxBytes: 20 * MB,
    },
  },

  // OpenAI image generation. gpt-image-2 accepts arbitrary WxH beyond the
  // standard sizes: both edges divisible by 16, ratio ≤ 3:1, total pixels
  // 655,360–8,294,400, longest edge ≤ 3840; "auto" lets the model pick.
  // Reference images: png/webp/jpg, ≤ 50MB each, up to 16.
  ...(['gpt-image-2', 'gpt-image-2-2026-04-21'] as const).map((id) => ({
    id,
    provider: 'openai' as const,
    lifecycle: {
      status: 'retiring' as const,
      effective: '2027-02-10',
      replacement: 'gpt-image-2.6-sunburst or gpt-image-2.6-flare',
      source: 'https://developers.openai.com/api/docs/deprecations.md',
    },
    capabilities: {
      sizeRange: {
        separator: 'x' as const,
        allowAuto: true,
        minArea: 655_360,
        maxArea: 8_294_400,
        minRatio: 1 / 3,
        maxRatio: 3,
        divisibleBy: 16,
        maxEdge: 3840,
      },
      qualityValues: ['low', 'medium', 'high', 'auto'],
      outputFormats: ['png', 'jpeg', 'webp'] as Array<'png' | 'jpeg' | 'webp'>,
      backgroundValues: ['auto', 'transparent', 'opaque'] as Array<'auto' | 'transparent' | 'opaque'>,
      supportsOutputCompression: true,
      supportsMask: true,
      nMax: 10,
      maxReferenceImages: 16,
      inputFormats: ['PNG', 'WEBP', 'JPEG'],
      inputMaxBytes: 50 * MB,
    },
  })),

  // GPT Image 2.5 adds xhigh/max and supports the same arbitrary-size range
  // documented for GPT Image 2. The Images API publishes n=1..10. Reference
  // metadata stays on conservative extension ceilings where the checked docs
  // do not publish a narrower model-specific edit-input contract.
  ...([
    'gpt-image-2.5-flare',
    'gpt-image-2.5-flare-2026-09-08',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-sunburst-2026-09-08',
  ] as const).map((id) => ({
    id,
    provider: 'openai' as const,
    capabilities: {
      sizeRange: {
        separator: 'x' as const,
        allowAuto: true,
        minArea: 655_360,
        maxArea: 8_294_400,
        minRatio: 1 / 3,
        maxRatio: 3,
        divisibleBy: 16,
        maxEdge: 3840,
      },
      qualityValues: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
      outputFormats: ['png', 'jpeg', 'webp'] as Array<'png' | 'jpeg' | 'webp'>,
      backgroundValues: ['auto', 'transparent', 'opaque'] as Array<'auto' | 'transparent' | 'opaque'>,
      supportsOutputCompression: true,
      supportsMask: true,
      supportsMarkup: true,
      nMax: 10,
      maxReferenceImages: 16,
      inputFormats: ['PNG', 'WEBP', 'JPEG'],
      inputMaxBytes: 20 * MB,
      referenceLimitsSource: 'extension' as const,
    },
  })),

  // GPT Image 2.6 (Flare = fast iteration, Sunburst = detailed work). The Image API adds complexity
  // planning, markup-guided edits, native GIF animation and native SVG output. The model pages do
  // not publish a size table; the API-wide arbitrary WxH range documented for 2.5 is carried over as
  // advice and the provider stays the authority. Quality lists the values the 2.6 material names
  // (low/medium/high); the API reference documents xhigh/max only for 2.5. GIF and SVG are
  // generation-only, and the API gates them on GIF-preview and SVG-model-selection access.
  ...(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'] as const).map((id) => ({
    id,
    provider: 'openai' as const,
    capabilities: {
      sizeRange: {
        separator: 'x' as const,
        allowAuto: true,
        minArea: 655_360,
        maxArea: 8_294_400,
        minRatio: 1 / 3,
        maxRatio: 3,
        divisibleBy: 16,
        maxEdge: 3840,
      },
      qualityValues: ['low', 'medium', 'high', 'auto'],
      outputFormats: ['png', 'jpeg', 'webp', 'gif', 'svg'] as Array<
        'png' | 'jpeg' | 'webp' | 'gif' | 'svg'
      >,
      supportsSvgAuthor: true,
      complexityValues: ['low', 'medium', 'high'] as Array<'low' | 'medium' | 'high'>,
      backgroundValues: ['auto', 'transparent', 'opaque'] as Array<'auto' | 'transparent' | 'opaque'>,
      supportsOutputCompression: true,
      supportsMask: true,
      supportsMarkup: true,
      nMax: 10,
      maxReferenceImages: 16,
      inputFormats: ['PNG', 'WEBP', 'JPEG'],
      inputMaxBytes: 20 * MB,
      referenceLimitsSource: 'extension' as const,
    },
  })),

  // Meta Muse Image. The built-in route uses the documented one-shot Images
  // endpoints; custom `api: meta` providers keep the conversational Responses
  // wire shape. Input metadata below is an extension safety contract rather
  // than an asserted provider limit. Requests are stateless in this extension;
  // callers iterate by passing the previous output as an input image.
  // https://dev.meta.ai/docs/image-generation
  {
    id: 'muse-image-1.0',
    aliases: ['muse-image', 'meta-muse'],
    provider: 'meta',
    capabilities: {
      // Meta's public cookbook demonstrates these sizes but does not publish an
      // exhaustive enum, so size stays a free-form provider-validated string.
      nMax: 1,
      maxReferenceImages: 16,
      inputFormats: META_INPUT_FORMATS,
      inputMaxBytes: 20 * MB,
      referenceLimitsSource: 'extension',
    },
  },

  // Microsoft Foundry MAI image catalog. API `model` is the Azure deployment
  // name; these entries describe deployments named after the model.
  // Versions: 2.5/Flash 2026-06-02, Pro 2026-06-19, 2.6/Flash 2026-07-31,
  // 2.7/Flash 2026-11-02.
  // https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image
  ...([
    'MAI-Image-2.5',
    'MAI-Image-2.5-Flash',
    'MAI-Image-2.5-Pro',
    'MAI-Image-2.6',
    'MAI-Image-2.6-Flash',
  ] as const).map((id) => ({
    id,
    provider: 'mai' as const,
    ...(id.startsWith('MAI-Image-2.5') ? {
      lifecycle: {
        status: 'retiring' as const,
        effective: '2026-11-24',
        source: 'https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule',
      },
    } : {}),
    capabilities: {
      sizeRange: {
        separator: 'x' as const,
        minArea: 768 * 768,
        maxArea: id.startsWith('MAI-Image-2.6') ? 2_359_296 : 1_048_576,
      },
      nMax: 1,
      maxReferenceImages: 5,
      inputFormats: ['PNG', 'JPEG'],
      inputMaxBytes: 20 * MB,
      // Microsoft publishes count/formats, not a per-file byte limit.
      referenceLimitsSource: 'extension' as const,
    },
  })),
  // MAI 2.7 adds transparent-background generation. Microsoft's inspected
  // table gives no 2.7 pixel ceiling, so `size` has no invented local range;
  // the Azure deployment remains the authority. The endpoint and 768px floor
  // are shared with 2.5/2.6.
  ...(['MAI-Image-2.7', 'MAI-Image-2.7-Flash'] as const).map((id) => ({
    id,
    provider: 'mai' as const,
    lifecycle: {
      status: 'preview' as const,
      source: 'https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image',
    },
    capabilities: {
      backgroundValues: ['opaque', 'transparent'] as Array<'opaque' | 'transparent'>,
      nMax: 1,
      maxReferenceImages: 5,
      inputFormats: ['PNG', 'JPEG'],
      inputMaxBytes: 20 * MB,
      referenceLimitsSource: 'extension' as const,
    },
  })),

  // Google Gemini "Nano Banana" image generation. Gemini has no pixel-size
  // knob — output shape is aspectRatio + imageSize tier (uppercase "K").
  // Per https://ai.google.dev/gemini-api/docs/image-generation:
  //   Nano Banana Pro      → gemini-3-pro-image
  //   Nano Banana 2        → gemini-3.1-flash-image
  //   Nano Banana 2 Lite   → gemini-3.1-flash-lite-image
  //   Nano Banana          → gemini-2.5-flash-image
  // Input formats PNG/JPEG/WEBP/HEIC/HEIF; inline requests cap at 20MB total.
  {
    id: 'gemini-3-pro-image',
    aliases: ['nano-banana-pro'],
    provider: 'gemini',
    capabilities: {
      aspectRatios: GEMINI_ASPECTS_10,
      imageSizes: ['1K', '2K', '4K'],
      nMax: 8,
      maxReferenceImages: 14,
      inputFormats: GEMINI_INPUT_FORMATS,
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'gemini-nano-banana-2.1',
    aliases: ['nano-banana-2-1'],
    provider: 'gemini',
    capabilities: {
      aspectRatios: GEMINI_ASPECTS_14,
      imageSizes: ['1K', '2K', '4K'],
      supportsThoughtOutput: true,
      thinkingLevels: ['minimal', 'medium', 'high'],
      supportsSearchGrounding: true,
      supportsImageSearchGrounding: true,
      nMax: 8,
      maxReferenceImages: 14,
      inputFormats: GEMINI_INPUT_FORMATS,
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'gemini-3.1-flash-image',
    aliases: ['nano-banana-2'],
    provider: 'gemini',
    lifecycle: {
      status: 'deprecated',
      replacement: 'gemini-nano-banana-2.1',
      source: 'https://ai.google.dev/gemini-api/docs/deprecations',
    },
    capabilities: {
      aspectRatios: GEMINI_ASPECTS_14,
      // GenerateContent's ImageConfig documents the tiny tier literal as "512".
      imageSizes: ['512', '1K', '2K', '4K'],
      supportsThoughtOutput: true,
      thinkingLevels: ['minimal', 'high'],
      supportsSearchGrounding: true,
      supportsImageSearchGrounding: true,
      nMax: 8,
      maxReferenceImages: 14,
      inputFormats: GEMINI_INPUT_FORMATS,
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    aliases: ['nano-banana-2-lite'],
    provider: 'gemini',
    capabilities: {
      aspectRatios: GEMINI_ASPECTS_14,
      imageSizes: ['1K'], // fixed at 1K — the schema hides imageSize entirely
      supportsThoughtOutput: true,
      thinkingLevels: ['minimal', 'high'],
      nMax: 8,
      maxReferenceImages: 14,
      inputFormats: GEMINI_INPUT_FORMATS,
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'gemini-2.5-flash-image',
    aliases: ['nano-banana'],
    provider: 'gemini',
    lifecycle: {
      status: 'retiring',
      effective: '2027-03-15',
      replacement: 'gemini-3.1-flash-lite-image',
      source: 'https://ai.google.dev/gemini-api/docs/deprecations',
    },
    capabilities: {
      aspectRatios: GEMINI_ASPECTS_10,
      // No imageSize knob — fixed 1024px output. Works best with ≤ 3 inputs.
      nMax: 8,
      maxReferenceImages: 3,
      inputFormats: GEMINI_INPUT_FORMATS,
      inputMaxBytes: 20 * MB,
    },
  },

  // Alibaba Qwen-Image series via DashScope (sync multimodal-generation).
  // Size is "<width>*<height>" (asterisk, NOT "x"); total pixels must stay
  // between 512*512 and 2048*2048. Reference images: JPG/JPEG/PNG/BMP/TIFF/
  // WEBP/GIF, ≤ 10MB each, up to 3. Output is always PNG.
  ...(['qwen-image-3.0-pro', 'qwen-image-3.0'] as const).map((id) => ({
    id,
    provider: 'dashscope' as const,
    capabilities: {
      sizeRange: QWEN3_SIZE_RANGE,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsPromptEnhance: true,
      supportsEnableThinking: true,
      supportsWatermark: true,
      nMax: 6,
      maxReferenceImages: 3,
      inputFormats: QWEN_INPUT_FORMATS,
      inputMaxBytes: 10 * MB,
      inputDimAdvice: 'reference images work best with both dimensions between 384 and 2048 px',
    },
  })),
  // Qwen Image 2.1 keeps the 3.0 size window but accepts up to 10 references
  // and can emit alpha automatically. Alibaba documents negative_prompt only
  // for the 3.0 series, so that control stays off here.
  ...(['qwen-image-2.1-pro', 'qwen-image-2.1-turbo'] as const).map((id) => ({
    id,
    provider: 'dashscope' as const,
    capabilities: {
      sizeRange: QWEN3_SIZE_RANGE,
      supportsSeed: true,
      supportsPromptEnhance: true,
      supportsWatermark: true,
      nMax: 6,
      maxReferenceImages: 10,
      inputFormats: QWEN_INPUT_FORMATS,
      inputMaxBytes: 10 * MB,
      inputDimAdvice: 'reference images work best with both dimensions between 384 and 2048 px',
    },
  })),
  {
    id: 'qwen-image-2.0-pro',
    provider: 'dashscope',
    capabilities: {
      // No aspect-ratio cap is documented for the 2.0 series (unlike 3.0).
      sizeRange: { separator: '*', minArea: 512 * 512, maxArea: 2048 * 2048 },
      nMax: 6,
      maxReferenceImages: 3,
      inputFormats: QWEN_INPUT_FORMATS,
      inputMaxBytes: 10 * MB,
      inputDimAdvice: 'reference images work best with both dimensions between 384 and 3072 px',
    },
  },
  {
    id: 'qwen-image-2.0',
    provider: 'dashscope',
    capabilities: {
      sizeRange: { separator: '*', minArea: 512 * 512, maxArea: 2048 * 2048 },
      nMax: 6,
      maxReferenceImages: 3,
      inputFormats: QWEN_INPUT_FORMATS,
      inputMaxBytes: 10 * MB,
      inputDimAdvice: 'reference images work best with both dimensions between 384 and 3072 px',
    },
  },

  // ByteDance Seedream via Volcengine Ark. `size` takes EITHER a tier token
  // (model-specific list) OR an explicit "<w>x<h>" pixel string — never mix
  // forms. The `seedream` alias points at the latest stable Seedream release.
  // Docs: https://www.volcengine.com/docs/82379/1824121
  //
  // Registry note (2026-08): the current docs list 5.0 pro as -260628 (the
  // older -260128 id no longer appears) and treat doubao-seedream-5-0-260128
  // and doubao-seedream-5-0-lite-260128 as the SAME model — hence the merged
  // entry below. The retired ids stay as aliases so existing configs resolve.
  {
    id: 'doubao-seedream-5-5-261028',
    aliases: ['seedream-5-5'],
    provider: 'ark',
    capabilities: {
      supportsWatermark: true,
      supportsLayerDecomposition: true,
      supportsLayerTextRecognition: true,
      layerMaxImages: { min: 2, max: 100 },
      layerOutputMax: 100,
      backgroundValues: ['auto', 'opaque', 'transparent'],
      sizeRange: {
        separator: 'x' as const,
        tiers: ['1K', '1.5K', '2K'],
        minArea: 921_600,
        maxArea: 4_624_220,
        minRatio: 1 / 16,
        maxRatio: 16,
      },
      nMax: 1,
      maxReferenceImages: 10,
      inputFormats: SEEDREAM_INPUT_FORMATS,
      inputMaxBytes: 30 * MB,
      inputDimAdvice: SEEDREAM_DIM_ADVICE,
    },
  },
  {
    id: 'doubao-seedream-5-0-pro-260628',
    aliases: ['seedream-5-pro', 'doubao-seedream-5-0-pro-260128'],
    provider: 'ark',
    capabilities: {
      backgroundValues: ['opaque', 'transparent'],
      supportsLayerDecomposition: true,
      // Volcengine documents 1 base image plus up to 16 layers for 5.0 Pro/Flash,
      // but the max_images request control is 5.5-only.
      layerOutputMax: 17,
      // 5.0 pro accepts 1K/1.5K/2K tiers; pixel range 1280x720–2048x2048-class.
      // Unlike the non-Pro 5.0 model, Pro does not support related series output.
      supportsWatermark: true,
      sizeRange: {
        separator: 'x' as const,
        tiers: ['1K', '1.5K', '2K'],
        minArea: 921_600,
        maxArea: 4_624_220,
        minRatio: 1 / 16,
        maxRatio: 16,
      },
      nMax: 1, // no count knob — sequential_image_generation is not exposed
      maxReferenceImages: 10,
      inputFormats: SEEDREAM_INPUT_FORMATS,
      inputMaxBytes: 30 * MB,
      inputDimAdvice: SEEDREAM_DIM_ADVICE,
    },
  },
  {
    id: 'doubao-seedream-5-0-flash-260915',
    aliases: ['seedream-5-flash'],
    provider: 'ark',
    capabilities: {
      supportsWatermark: true,
      supportsLayerDecomposition: true,
      backgroundValues: ['opaque', 'transparent'],
      layerOutputMax: 17,
      sizeRange: {
        separator: 'x' as const,
        tiers: ['1K', '1.5K', '2K'],
        minArea: 921_600,
        maxArea: 4_624_220,
        minRatio: 1 / 16,
        maxRatio: 16,
      },
      nMax: 1,
      maxReferenceImages: 10,
      inputFormats: SEEDREAM_INPUT_FORMATS,
      inputMaxBytes: 30 * MB,
      inputDimAdvice: SEEDREAM_DIM_ADVICE,
    },
  },
  {
    id: 'doubao-seedream-5-0-260128',
    aliases: ['seedream-5', 'seedream', 'doubao-seedream-5-0-lite-260128', 'seedream-5-lite'],
    provider: 'ark',
    capabilities: {
      // 5.0 (lite): 2K floor — 1K pixel sizes fail with InvalidParameter.
      supportsWatermark: true,
      supportsSeries: true,
      sizeRange: {
        separator: 'x' as const,
        tiers: ['2K', '3K', '4K'],
        minArea: 3_686_400,
        maxArea: 16_777_216,
        minRatio: 1 / 16,
        maxRatio: 16,
      },
      nMax: 1,
      maxReferenceImages: 14,
      inputFormats: SEEDREAM_INPUT_FORMATS,
      inputMaxBytes: 30 * MB,
      inputDimAdvice: SEEDREAM_DIM_ADVICE,
    },
  },
  {
    id: 'doubao-seedream-4-5-251128',
    aliases: ['seedream-4-5'],
    provider: 'ark',
    capabilities: {
      supportsWatermark: true,
      supportsSeries: true,
      sizeRange: {
        separator: 'x' as const,
        tiers: ['2K', '4K'],
        minArea: 3_686_400,
        maxArea: 16_777_216,
        minRatio: 1 / 16,
        maxRatio: 16,
      },
      nMax: 1,
      maxReferenceImages: 14,
      inputFormats: SEEDREAM_INPUT_FORMATS,
      inputMaxBytes: 30 * MB,
      inputDimAdvice: SEEDREAM_DIM_ADVICE,
    },
  },
  {
    id: 'doubao-seedream-4-0-250828',
    aliases: ['seedream-4'],
    provider: 'ark',
    capabilities: {
      // 4.0 is the only Seedream that still accepts 1K-class pixel sizes.
      supportsWatermark: true,
      supportsSeries: true,
      sizeRange: {
        separator: 'x' as const,
        tiers: ['1K', '2K', '4K'],
        minArea: 921_600,
        maxArea: 16_777_216,
        minRatio: 1 / 16,
        maxRatio: 16,
      },
      nMax: 1,
      maxReferenceImages: 14,
      inputFormats: SEEDREAM_INPUT_FORMATS,
      inputMaxBytes: 30 * MB,
      inputDimAdvice: SEEDREAM_DIM_ADVICE,
    },
  },

  // Black Forest Labs FLUX.2 direct API. Auth is `x-key`; generation is a
  // task submit followed by polling the returned `polling_url`. The API
  // accepts explicit width/height >= 64 and documents up to 4MP output.
  // https://docs.bfl.ml/api_integration/integration_guidelines
  ...(['flux-2-pro', 'flux-2-flex', 'flux-2-max', 'flux-2-klein-4b', 'flux-2-klein-9b'] as const).map((id) => ({
    id,
    ...(id === 'flux-2-pro' ? { aliases: ['flux-2-pro-preview'] } : {}),
    ...(id === 'flux-2-klein-9b' ? { aliases: ['flux-2-klein-9b-preview'] } : {}),
    provider: 'bfl' as const,
    capabilities: {
      sizeRange: {
        separator: 'x' as const,
        minArea: 64 * 64,
        maxArea: 4_000_000,
      },
      outputFormats: ['png', 'jpeg', 'webp'] as Array<'png' | 'jpeg' | 'webp'>,
      supportsPromptEnhance: true,
      supportsSeed: true,
      nMax: 1,
      maxReferenceImages: id.startsWith('flux-2-klein') ? 4 : 8,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
      referenceLimitsSource: 'extension' as const,
    },
  })),

  // Adobe Firefly Image5. The verified v4 endpoint selects Image5 with the
  // required x-model-version header and uses IMS client-credentials auth.
  // https://developer.adobe.com/firefly-services/docs/firefly-api/
  {
    id: 'firefly-image5',
    aliases: ['firefly_image', 'firefly-image'],
    provider: 'adobe-firefly',
    remoteId: 'firefly_image',
    capabilities: {
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', 'auto'],
      resolutionLevels: ['1MP', '2.4MP', '4MP'],
      promptReasonerValues: ['speed', 'quality'],
      supportsSeed: true,
      nMax: 1,
      maxReferenceImages: 1,
      inputFormats: ['PNG', 'JPEG', 'WEBP', 'BMP', 'TIFF', 'HEIC', 'HEIF'],
      inputMaxBytes: 10 * MB,
    },
  },

  // Stability AI /v2beta image services. Multipart requests accept `image/*`
  // or JSON base64 responses; this adapter uses the documented JSON form.
  // https://docs.stability.ai/api-reference
  ...(['stable-image-core', 'stable-image-ultra'] as const).map((id) => ({
    id,
    provider: 'stability' as const,
    capabilities: {
      aspectRatios: STABILITY_RATIOS,
      outputFormats: ['png', 'jpeg', 'webp'] as Array<'png' | 'jpeg' | 'webp'>,
      supportsNegativePrompt: true,
      supportsSeed: true,
      nMax: 1,
      maxReferenceImages: 0,
      inputFormats: [] as string[],
      inputMaxBytes: 10 * MB,
    },
  })),
  ...(['sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium'] as const).map((id) => ({
    id,
    provider: 'stability' as const,
    capabilities: {
      aspectRatios: STABILITY_RATIOS,
      outputFormats: ['png', 'jpeg', 'webp'] as Array<'png' | 'jpeg' | 'webp'>,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStrength: true,
      nMax: 1,
      maxReferenceImages: 1,
      inputFormats: ['JPEG', 'PNG', 'WEBP'],
      inputMaxBytes: 10 * MB,
    },
  })),

  // Alibaba Model Studio Wan 2.7 and Z-Image. Both use the DashScope
  // multimodal-generation request envelope; Wan also documents an async task
  // endpoint and image-set mode. https://www.alibabacloud.com/help/en/model-studio
  ...(['wan2.7-image-pro', 'wan2.7-image'] as const).map((id) => ({
    id,
    provider: 'dashscope' as const,
    capabilities: {
      sizeRange: {
        separator: 'x' as const,
        tiers: id === 'wan2.7-image-pro' ? ['1K', '2K', '4K'] : ['1K', '2K'],
        minArea: 768 * 768,
        maxArea: id === 'wan2.7-image-pro' ? 4096 * 4096 : 2048 * 2048,
        minRatio: 1 / 8,
        maxRatio: 8,
      },
      supportsSeed: true,
      supportsWatermark: true,
      supportsEnableThinking: true,
      supportsAsyncMode: true,
      supportsSequentialSets: true,
      sequentialMaxImages: { min: 1, max: 10 },
      nMax: 4,
      maxReferenceImages: 9,
      inputFormats: ['JPEG', 'JPG', 'PNG', 'BMP', 'WEBP'],
      inputMaxBytes: 20 * MB,
      inputDimAdvice: 'reference images: each dimension 240–8000 px and aspect ratio 1:8–8:1',
    },
  })),
  {
    id: 'z-image-turbo',
    provider: 'dashscope',
    capabilities: {
      sizeRange: {
        separator: '*' as const,
        minArea: 512 * 512,
        maxArea: 2048 * 2048,
      },
      supportsSeed: true,
      supportsPromptEnhance: true,
      nMax: 1,
      maxReferenceImages: 0,
      inputFormats: [] as string[],
      inputMaxBytes: 10 * MB,
    },
  },

  // Recraft dedicated REST API. All model ids, sizes and parameter support
  // come from https://www.recraft.ai/docs/api-reference/agents.md.
  {
    id: 'recraftv4_1_flash_v2',
    provider: 'recraft',
    capabilities: {
      sizes: RECRAFT_1K_SIZES,
      supportsSeed: true,
      supportsColorControls: true,
      responseFormats: ['url', 'b64_json'],
      outputFormats: ['png', 'webp'] as Array<'png' | 'webp'>,
      operations: ['generate'],
      nMax: 6,
      maxReferenceImages: 0,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  },
  ...(['recraftv4_1', 'recraftv4', 'recraftv4_1_utility'] as const).map((id) => ({
    id,
    provider: 'recraft' as const,
    capabilities: {
      sizes: RECRAFT_1K_SIZES,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['flexible', 'precise'],
      responseFormats: ['url', 'b64_json'] as Array<'url' | 'b64_json'>,
      outputFormats: ['png', 'webp'] as Array<'png' | 'webp'>,
      operations: ['generate', 'imageToImage'] as Array<'generate' | 'imageToImage'>,
      supportsStrength: true,
      nMax: 6,
      maxReferenceImages: 1,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  })),
  ...(['recraftv4_1_pro', 'recraftv4_pro', 'recraftv4_1_utility_pro'] as const).map((id) => ({
    id,
    provider: 'recraft' as const,
    capabilities: {
      sizes: RECRAFT_2K_SIZES,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['flexible', 'precise'],
      responseFormats: ['url', 'b64_json'] as Array<'url' | 'b64_json'>,
      outputFormats: ['png', 'webp'] as Array<'png' | 'webp'>,
      operations: ['generate', 'imageToImage'] as Array<'generate' | 'imageToImage'>,
      supportsStrength: true,
      nMax: 6,
      maxReferenceImages: 1,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  })),
  {
    id: 'recraftv4_styles',
    provider: 'recraft',
    capabilities: {
      sizes: RECRAFT_1K_SIZES,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['flexible', 'precise'],
      responseFormats: ['url', 'b64_json'],
      outputFormats: ['png', 'webp'],
      operations: ['generate'],
      nMax: 6,
      maxReferenceImages: 0,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'recraftv4_styles_pro',
    provider: 'recraft',
    capabilities: {
      sizes: RECRAFT_2K_SIZES,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['flexible', 'precise'],
      responseFormats: ['url', 'b64_json'],
      outputFormats: ['png', 'webp'],
      operations: ['generate'],
      nMax: 6,
      maxReferenceImages: 0,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  },
  ...(['recraftv4_1_vector', 'recraftv4_1_utility_vector', 'recraftv4_vector'] as const).map((id) => ({
    id,
    provider: 'recraft' as const,
    capabilities: {
      aspectRatios: RECRAFT_RATIOS,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['flexible', 'precise'],
      responseFormats: ['url', 'b64_json'] as Array<'url' | 'b64_json'>,
      outputFormats: ['svg'] as Array<'svg'>,
      operations: ['generate', 'imageToImage'] as Array<'generate' | 'imageToImage'>,
      supportsSvgEdits: true,
      supportsSvgVariants: true,
      supportsStrength: true,
      nMax: 6,
      maxReferenceImages: 1,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  })),
  ...(['recraftv4_1_pro_vector', 'recraftv4_1_utility_pro_vector', 'recraftv4_pro_vector'] as const).map((id) => ({
    id,
    provider: 'recraft' as const,
    capabilities: {
      aspectRatios: RECRAFT_RATIOS,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['flexible', 'precise'],
      responseFormats: ['url', 'b64_json'] as Array<'url' | 'b64_json'>,
      outputFormats: ['svg'] as Array<'svg'>,
      operations: ['generate', 'imageToImage'] as Array<'generate' | 'imageToImage'>,
      supportsSvgEdits: true,
      supportsSvgVariants: true,
      supportsStrength: true,
      nMax: 6,
      maxReferenceImages: 1,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  })),
  ...(['recraftv4_styles_vector', 'recraftv4_styles_pro_vector'] as const).map((id) => ({
    id,
    provider: 'recraft' as const,
    capabilities: {
      aspectRatios: RECRAFT_RATIOS,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['flexible', 'precise'],
      responseFormats: ['url', 'b64_json'] as Array<'url' | 'b64_json'>,
      outputFormats: ['svg'] as Array<'svg'>,
      operations: ['generate'] as Array<'generate'>,
      supportsSvgVariants: true,
      nMax: 6,
      maxReferenceImages: 0,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  })),
  {
    id: 'recraftv3',
    provider: 'recraft',
    capabilities: {
      sizes: RECRAFT_LEGACY_SIZES,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['regular'],
      supportsTextLayout: true,
      supportsStrength: true,
      supportsMask: true,
      responseFormats: ['url', 'b64_json'],
      outputFormats: ['png', 'webp'],
      operations: ['generate', 'imageToImage', 'inpaint', 'outpaint', 'replaceBackground', 'generateBackground', 'vectorize', 'variateImage'],
      nMax: 6,
      maxReferenceImages: 1,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'recraftv3_vector',
    provider: 'recraft',
    capabilities: {
      aspectRatios: RECRAFT_RATIOS,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['regular'],
      supportsTextLayout: true,
      supportsStrength: true,
      supportsMask: true,
      responseFormats: ['url', 'b64_json'],
      outputFormats: ['svg'],
      operations: ['generate', 'imageToImage', 'inpaint', 'outpaint', 'replaceBackground', 'generateBackground', 'vectorize', 'variateImage'],
      supportsSvgEdits: true,
      supportsSvgVariants: true,
      nMax: 6,
      maxReferenceImages: 1,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'recraftv2',
    provider: 'recraft',
    capabilities: {
      sizes: RECRAFT_LEGACY_SIZES,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['regular'],
      responseFormats: ['url', 'b64_json'],
      outputFormats: ['png', 'webp'],
      operations: ['generate'],
      nMax: 6,
      maxReferenceImages: 0,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  },
  {
    id: 'recraftv2_vector',
    provider: 'recraft',
    capabilities: {
      aspectRatios: RECRAFT_RATIOS,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsColorControls: true,
      supportsStyleReferences: true,
      styleMatchValues: ['regular'],
      responseFormats: ['url', 'b64_json'],
      outputFormats: ['svg'],
      operations: ['generate'],
      supportsSvgVariants: true,
      nMax: 6,
      maxReferenceImages: 0,
      inputFormats: ['PNG', 'JPEG', 'WEBP'],
      inputMaxBytes: 20 * MB,
    },
  },
];

/** Common Azure GPT Image controls for deployments with custom names. */
export const AZURE_OPENAI_CAPABILITIES = {
  qualityValues: ['low', 'medium', 'high', 'auto'],
  // Microsoft's image guide explicitly excludes WebP despite the broader
  // wire enum in its REST reference. Keep Azure's advertised formats narrow.
  outputFormats: ['png', 'jpeg'],
  backgroundValues: ['auto', 'transparent', 'opaque'],
  supportsOutputCompression: true,
  supportsMask: true,
  nMax: 10,
  maxReferenceImages: 16,
  inputFormats: ['PNG', 'JPEG'],
  inputMaxBytes: 20 * MB,
  referenceLimitsSource: 'extension',
} satisfies ImageModelCapabilities;

// Keep Azure metadata separate: an unscoped gpt-image-2 must still choose the
// public OpenAI route. Azure API `model` is the deployment name, not an alias.
// https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/dall-e
const AZURE_OPENAI_MODELS: BuiltInModelEntry[] = [
  ...BUILT_IN_MODELS.filter((model) =>
    model.provider === 'openai' &&
    ['gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(model.id),
  ).map((model) => ({
    ...model,
    provider: 'azure-openai' as const,
    capabilities: {
      ...AZURE_OPENAI_CAPABILITIES,
      ...model.capabilities,
      outputFormats: AZURE_OPENAI_CAPABILITIES.outputFormats,
      inputFormats: AZURE_OPENAI_CAPABILITIES.inputFormats,
      inputMaxBytes: AZURE_OPENAI_CAPABILITIES.inputMaxBytes,
      referenceLimitsSource: 'extension' as const,
    },
  })),
  // gpt-image-1 shut down on 2026-10-23 and is intentionally absent. The next
  // two deployments retire on 2026-12-01 but remain resolvable for existing
  // Azure deployment names until that date.
  ...['gpt-image-1-mini', 'gpt-image-1.5'].map((id) => ({
    id,
    provider: 'azure-openai' as const,
    lifecycle: {
      status: 'retiring' as const,
      effective: '2026-12-01',
      replacement: 'gpt-image-2.6-sunburst or gpt-image-2.6-flare',
      source: 'https://developers.openai.com/api/docs/deprecations.md',
    },
    capabilities: {
      ...AZURE_OPENAI_CAPABILITIES,
      sizes: ['auto', '1024x1024', '1536x1024', '1024x1536'],
    },
  })),
];

export function modelsForProvider(id: BuiltInProviderId): BuiltInModelEntry[] {
  return id === 'azure-openai'
    ? AZURE_OPENAI_MODELS
    : BUILT_IN_MODELS.filter((model) => model.provider === id);
}

/** Compact status text for provider listings; no lifecycle means no annotation. */
export function describeModelLifecycle(entry: BuiltInModelEntry | undefined): string | undefined {
  const lifecycle = entry?.lifecycle;
  if (!lifecycle) return undefined;
  const label = lifecycle.status === 'preview' ? 'preview' : lifecycle.effective
    ? `${lifecycle.status} ${lifecycle.effective}` : lifecycle.status;
  return lifecycle.replacement ? `${label}; use ${lifecycle.replacement}` : label;
}

/** Resolve a model id or alias against the built-in registry. */
export function findBuiltInModel(idOrAlias: string): BuiltInModelEntry | undefined {
  return BUILT_IN_MODELS.find(
    (entry) => entry.id === idOrAlias || entry.aliases?.includes(idOrAlias),
  );
}

export const DEFAULT_BASE_URL: Record<BuiltInProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  dashscope: 'https://dashscope.aliyuncs.com/api/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
  meta: 'https://api.meta.ai/v1',
  // Azure resource-specific endpoint: intentionally no shared service default.
  mai: '',
  'azure-openai': '',
  codex: 'https://chatgpt.com/backend-api/codex/images',
  bfl: 'https://api.bfl.ai',
  'adobe-firefly': 'https://firefly-api.adobe.io',
  stability: 'https://api.stability.ai',
  recraft: 'https://external.api.recraft.ai/v1',
};

export const DEFAULT_API_STYLE: Record<BuiltInProviderId, ApiStyle> = {
  openai: 'openai',
  'azure-openai': 'openai',
  gemini: 'gemini',
  dashscope: 'dashscope',
  openrouter: 'openrouter',
  ark: 'ark',
  meta: 'meta',
  mai: 'mai',
  codex: 'codex',
  bfl: 'bfl',
  'adobe-firefly': 'adobe-firefly',
  stability: 'stability',
  recraft: 'recraft',
};

export const ENV_VARS: Partial<Record<BuiltInProviderId, string>> = {
  openai: 'OPENAI_API_KEY',
  'azure-openai': 'AZURE_OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  ark: 'ARK_API_KEY',
  meta: 'META_API_KEY',
  mai: 'AZURE_MAI_API_KEY',
  bfl: 'BFL_API_KEY',
  'adobe-firefly': 'FIREFLY_SERVICES_CLIENT_ID',
  stability: 'STABILITY_API_KEY',
  recraft: 'RECRAFT_API_TOKEN',
};

export const PROVIDER_DISPLAY_NAME: Record<BuiltInProviderId, string> = {
  openai: 'OpenAI',
  'azure-openai': 'Azure OpenAI',
  gemini: 'Google Gemini',
  dashscope: 'Alibaba DashScope',
  openrouter: 'OpenRouter',
  ark: 'Volcengine Ark',
  meta: 'Meta Model API',
  mai: 'Microsoft MAI (Azure)',
  codex: 'ChatGPT Plus/Pro (Codex)',
  bfl: 'Black Forest Labs FLUX.2',
  'adobe-firefly': 'Adobe Firefly Services',
  stability: 'Stability AI',
  recraft: 'Recraft',
};
