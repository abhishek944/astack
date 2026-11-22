/**
 * Default generated-output locations.
 *
 * Every default is repository-relative and resolves against the caller/session
 * cwd, so unconfigured output stays inside the repository's ignored `var/` tree
 * instead of the Pi configuration directory. Package-owned segments prevent
 * collisions with session artifact directories; no Work or Task ID is invented
 * because these entrypoints have no task context.
 *
 * These are defaults only. An explicit `pi-image-gen.outputDir`,
 * `spriteGeneration.outputDir`, or per-call `outputDir` still wins unchanged and
 * may point anywhere, including outside `var/`.
 */
export const IMAGE_GEN_VAR_NAMESPACE = 'var/pi-image-gen';

/** Default directory for `image_generate`, `image_compare` and `generateImage()`. */
export const DEFAULT_IMAGE_OUTPUT_DIR = `${IMAGE_GEN_VAR_NAMESPACE}/images`;

/** Default sprite run root for `sprite_generate`. */
export const DEFAULT_SPRITE_OUTPUT_DIR = `${IMAGE_GEN_VAR_NAMESPACE}/sprites`;

/** Default download directory for `image_search` and `image_search_compare`. */
export const DEFAULT_SEARCH_OUTPUT_DIR = `${IMAGE_GEN_VAR_NAMESPACE}/search`;
