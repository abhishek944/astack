export type ImageResize = { width: number; height: number; fit?: 'contain' | 'cover' };

/** Provider output encodings the package can materialize, save and preview safely. */
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg';
/** Provider planning effort (GPT Image 2.6), independent of rendering quality. */
export type ImageComplexity = 'low' | 'medium' | 'high';
/** Reasoning effort of the text/instruct model that authors SVG output. */
export type SvgReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Gemini 3-family generateContent thinking levels. */
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
/** Provider-native prompt reasoning modes exposed by Firefly Image5. */
export type PromptReasoner = 'speed' | 'quality';
/** Recraft operations exposed by its dedicated REST endpoints. */
export type RecraftOperation =
  | 'generate'
  | 'imageToImage'
  | 'inpaint'
  | 'outpaint'
  | 'replaceBackground'
  | 'generateBackground'
  | 'vectorize'
  | 'variateImage'
  | 'removeBackground'
  | 'crispUpscale'
  | 'creativeUpscale'
  | 'enhance'
  | 'eraseRegion';
export type RecraftTextLayout = {
  text: string;
  bbox: [[number, number], [number, number], [number, number], [number, number]];
};
export type RgbColor = { rgb: [number, number, number]; weight?: number };

export type GenerateImageParams = {
  prompt: string;
  /**
   * Optional reference / input images for image-to-image, editing, style
   * transfer, or character preservation. Each entry MUST be either:
   *   - an absolute or relative file path on the local filesystem, or
   *   - an http(s) URL.
   *
   * `data:` URIs and raw base64 strings are intentionally rejected — tool
   * arguments don't survive megabyte-sized strings cleanly across providers.
   * If you have raw image bytes, write them to a file first.
   */
  image?: string[];
  /** Number of images to generate. Default 1. */
  n?: number;
  /** Image size hint (e.g. "1024x1024"). Provider may ignore. */
  size?: string;
  /**
   * Gemini-style aspect ratio (e.g. "16:9"). Only honored when the active
   * model's capabilities declare `aspectRatios` (Gemini image models have no
   * pixel-size knob); rejected by validation otherwise.
   */
  aspectRatio?: string;
  /**
   * Gemini-style size tier (e.g. "2K"). Only honored when the active model's
   * capabilities declare `imageSizes`; rejected by validation otherwise.
   */
  imageSize?: string;
  /**
   * Quality hint (e.g. "low" | "medium" | "high" | "auto" for OpenAI gpt-image).
   * Provider-specific: forwarded on OpenAI-shaped providers, ignored by adapters
   * that don't expose a quality knob.
   */
  quality?: string;
  /** Provider-supported output encoding. `gif` and `svg` are generation-only. */
  outputFormat?: ImageOutputFormat;
  /**
   * Provider planning effort, independent of `quality`. Only models whose
   * capabilities declare `complexityValues` accept it. For SVG output this
   * controls the reference image, not the SVG author's reasoning.
   */
  complexity?: ImageComplexity;
  /** Frames for native GIF output (generation only). Provider bounds are documented per model. */
  frameCount?: number;
  /** Per-frame delay in milliseconds for native GIF output (generation only). */
  frameDurationMs?: number;
  /**
   * Model that authors SVG output. Supply only when the account has SVG model
   * selection enabled; omit the whole SVG author object otherwise. The top-level
   * model still creates the reference image.
   */
  svgModel?: string;
  /** SVG author reasoning effort. Requires `svgModel`, matching the API's required `svg.model` when selection is enabled. */
  svgReasoningEffort?: SvgReasoningEffort;
  /** Provider-supported background behavior. */
  background?: 'auto' | 'transparent' | 'opaque';
  /**
   * OpenRouter response delivery. `url` returns a signed, expiring download
   * link instead of inline bytes; `b64_json` keeps bytes inline.
   */
  responseFormat?: 'b64_json' | 'url';
  /** JPEG/WebP compression from 0–100. */
  outputCompression?: number;
  /** Optional edit mask path/URL; exposed only for verified mask-capable models. */
  mask?: string;
  /**
   * Transparent annotation PNG overlaid on the first input image for
   * markup-guided edits. It cannot be combined with `mask`, and requires an
   * edit target in `image`.
   */
  markup?: string;
  /** Provider-native negative prompt. */
  negativePrompt?: string;
  /** Provider-native reproducibility seed. */
  seed?: number;
  /** Ask the provider to enhance/extend the prompt where supported. */
  promptEnhance?: boolean;
  /** Enable provider-side thinking where supported. */
  enableThinking?: boolean;
  /** Gemini generateContent maximum reasoning depth. */
  thinkingLevel?: GeminiThinkingLevel;
  /** Ask Gemini to return thought parts in the response. */
  includeThoughts?: boolean;
  /** Ground image generation in real-time Google Search results. */
  searchGrounding?: boolean;
  /** Also enable Google Image Search inside search grounding. */
  imageSearchGrounding?: boolean;
  /** Submit through a provider's documented asynchronous task endpoint. */
  asyncMode?: boolean;
  /** Wan image-set mode maximum; distinct from independent n variants. */
  sequentialMaxImages?: number;
  /** Firefly resolution level (for example "2.4MP"). */
  resolutionLevel?: string;
  /** Firefly prompt reasoning strategy. */
  promptReasoner?: PromptReasoner;
  /** Image-to-image influence, where the provider exposes strength/denoising. */
  strength?: number;
  /** Dedicated Recraft operation. Defaults to automatic endpoint selection from inputs. */
  operation?: RecraftOperation;
  /** Reuse a Recraft style created from reference images. */
  styleId?: string;
  /** Recraft style reference URLs or data URLs. */
  styleReferenceUrls?: string[];
  /** Recraft style matching mode. */
  styleMatch?: string;
  /** Recraft V3 exact text placement. */
  textLayout?: RecraftTextLayout[];
  /** Recraft color controls. */
  colorControls?: RgbColor[];
  /** Recraft background color control. */
  backgroundColor?: RgbColor;
  /** Add the provider's visible AI watermark where supported. Default false. */
  watermark?: boolean;
  /** Seedream related-series maximum; distinct from independent `n` variants. */
  seriesMaxImages?: number;
  /** Seedream 5.x: split one input image into a base image plus editable layers. */
  layerDecomposition?: boolean;
  /** Seedream 5.5 total layer output cap, including the base image. */
  layerMaxImages?: number;
  /** Seedream 5.5 rich OCR for regular text layers. */
  layerTextRecognition?: boolean;
  /** Output filename prefix. */
  filename?: string;
  /** Optional desktop-only exact-size PNG copy; provider size controls are unchanged. */
  resize?: ImageResize;
  /** Override settings.outputDir for this call. */
  outputDir?: string;
};

/** Materialized reference image, ready for adapters to encode. */
export type ResolvedImageInput = {
  bytes: Uint8Array;
  mimeType: string;
  /** Original public URL, when the caller supplied one instead of a local file. */
  sourceUrl?: string;
};

export type ImageDimensions = { width: number; height: number };

/**
 * Per-model capability contract, sourced from official provider docs (the
 * registry in models.ts quotes the values). Drives the tool schema shape at
 * registration time and pre-flight validation before any paid call — mirrors
 * pi-video-gen's `VideoModelCapabilities`.
 */
export type ImageModelCapabilities = {
  /**
   * Discrete allowed `size` values (DALL·E-style fixed lists). Mutually
   * exclusive with `sizeRange`; when present, `size` is a string enum.
   */
  sizes?: string[];
  /** Range-based `size` validation for "<width><sep><height>" pixel strings. */
  sizeRange?: {
    /** Separator the provider's API expects: qwen uses "*", everyone else "x". */
    separator: 'x' | '*';
    /** Tier tokens accepted instead of a pixel string (Seedream: "1K"/"2K"/…). */
    tiers?: string[];
    /** The literal "auto" is accepted (model picks the size; gpt-image-2). */
    allowAuto?: boolean;
    /** Inclusive total-pixel (width × height) bounds. */
    minArea: number;
    maxArea: number;
    /** Inclusive width/height ratio bounds. */
    minRatio?: number;
    maxRatio?: number;
    /** Both dimensions must be divisible by this (gpt-image-2: 16). */
    divisibleBy?: number;
    /** Longest-edge ceiling in px (gpt-image-2: 3840). */
    maxEdge?: number;
  };
  /**
   * Gemini-style aspect-ratio vocabulary. Its presence means the model has NO
   * pixel-size knob: the schema hides `size` and exposes `aspectRatio` instead.
   */
  aspectRatios?: string[];
  /**
   * Gemini-style `imageSize` tiers (e.g. ["1K","2K","4K"]). A single entry
   * means a fixed tier — the param is hidden from the schema. Absent means the
   * model has no tier knob at all (gemini-2.5-flash-image is fixed at 1024px).
   */
  imageSizes?: string[];
  /** Model-specific quality vocabulary when the provider exposes a quality knob. */
  qualityValues?: string[];
  outputFormats?: ImageOutputFormat[];
  /** Planning-effort vocabulary; absence means the model has no `complexity` knob. */
  complexityValues?: ImageComplexity[];
  backgroundValues?: Array<'auto' | 'transparent' | 'opaque'>;
  /** OpenRouter response delivery modes accepted by the adapter. */
  responseFormats?: Array<'b64_json' | 'url'>;
  supportsOutputCompression?: boolean;
  supportsMask?: boolean;
  /** Whether the edit path accepts a markup annotation layer. */
  supportsMarkup?: boolean;
  supportsNegativePrompt?: boolean;
  supportsSeed?: boolean;
  supportsPromptEnhance?: boolean;
  /** Legacy umbrella flag; mapped to the wire-specific thinking capability. */
  supportsThinking?: boolean;
  /** DashScope Qwen/Wan enable_thinking or thinking_mode request control. */
  supportsEnableThinking?: boolean;
  /** Gemini generationConfig.thinkingConfig.includeThoughts response control. */
  supportsThoughtOutput?: boolean;
  /** Gemini thinking levels accepted by generationConfig.thinkingConfig.thinkingLevel. */
  thinkingLevels?: GeminiThinkingLevel[];
  /** Gemini generateContent Google Search grounding support. */
  supportsSearchGrounding?: boolean;
  /** Gemini image-search grounding support; requires search grounding. */
  supportsImageSearchGrounding?: boolean;
  /** Alibaba Wan async task endpoint support. */
  supportsAsyncMode?: boolean;
  /** Alibaba Wan image-set mode support. */
  supportsSequentialSets?: boolean;
  /** Verified image-set maximum, including the extension ceiling. */
  sequentialMaxImages?: { min: number; max: number };
  /** Firefly resolution vocabulary. */
  resolutionLevels?: string[];
  /** Firefly prompt reasoner vocabulary. */
  promptReasonerValues?: PromptReasoner[];
  /** Image-to-image strength support. */
  supportsStrength?: boolean;
  /** Recraft dedicated operations supported by the selected model. */
  operations?: RecraftOperation[];
  supportsWatermark?: boolean;
  supportsSeries?: boolean;
  /** Seedream 5.x layer decomposition support. */
  supportsLayerDecomposition?: boolean;
  /** Seedream 5.5 rich text-layer OCR support. */
  supportsLayerTextRecognition?: boolean;
  /** Recraft style reference support. */
  supportsStyleReferences?: boolean;
  styleMatchValues?: string[];
  /** Recraft V3 text-layout support. */
  supportsTextLayout?: boolean;
  /** Recraft color-control support. */
  supportsColorControls?: boolean;
  /** Native SVG editing is documented by the selected model. */
  supportsSvgEdits?: boolean;
  /** Native SVG models document multiple outputs per request. */
  supportsSvgVariants?: boolean;
  /** OpenAI-only SVG author model selection. */
  supportsSvgAuthor?: boolean;
  /** Provider-documented request bounds for `layerMaxImages`, including the base image. */
  layerMaxImages?: { min: number; max: number };
  /** Provider-documented maximum outputs in layer mode, including the base image. */
  layerOutputMax?: number;
  /** Max images per request via `n`. 1 = the model has no count knob; `n` is hidden. */
  nMax: number;
  /** Whether nMax comes from provider docs or a conservative extension ceiling. */
  nMaxSource?: 'provider' | 'extension';
  /** Max reference images per request. */
  maxReferenceImages: number;
  /** Accepted reference-image formats as display labels (e.g. "PNG", "JPEG"). */
  inputFormats: string[];
  /** Per-reference-image byte ceiling. */
  inputMaxBytes: number;
  /** Whether reference count/format/byte values come from provider docs or local safety limits. */
  referenceLimitsSource?: 'provider' | 'extension';
  /**
   * Documented advisory for reference-image dimensions (e.g. "both dimensions
   * between 384 and 2048 px"). Surfaced in the `image` param description only —
   * it is a provider recommendation, never hard-validated.
   */
  inputDimAdvice?: string;
};
