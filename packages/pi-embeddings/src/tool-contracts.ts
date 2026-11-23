import {
  embeddingCompareResultSchema,
  embeddingRequestSchema,
  embeddingResultSchema,
} from './schemas.js';

export const EMBED_TOOL = 'embed';
export const EMBED_COMPARE_TOOL = 'embed_compare';

export const EMBED_TOOL_DESCRIPTION =
  'Embed one or more text inputs with the server-configured embedding route. Provider, model, fallback routes and credentials stay in trusted settings; this tool cannot override them. Returns vectors and their actual generating space as structured data. Full text is preserved; the package owns prefixing and provider batching. Use embed_compare only for an explicit comparison.';

export const EMBED_COMPARE_TOOL_DESCRIPTION =
  'Explicitly compare the same text inputs using exactly the configured compare routes. Every entry is a separate request and may incur charges. No implicit default, fallback, ranking or settings mutation.';

export const embedParameters = embeddingRequestSchema;
export const embedCompareParameters = embeddingRequestSchema;

export const embedOutput = embeddingResultSchema;
export const embedCompareOutput = embeddingCompareResultSchema;

export const EMBEDDINGS_TOOL_NAMES = [EMBED_TOOL, EMBED_COMPARE_TOOL] as const;
