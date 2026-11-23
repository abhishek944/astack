import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { EmbeddingsError } from './errors.js';
import { createEmbeddingsRuntime, type EmbeddingsRuntime } from './runtime.js';
import { loadEmbeddingSettings } from './settings.js';
import {
  EMBEDDING_CONTEXT_META_KEY,
  embeddingContextSchema,
  embeddingRequestSchema,
  type EmbeddingContext,
  type EmbeddingRequest,
  type EmbeddingSettings,
} from './schemas.js';
import {
  EMBED_COMPARE_TOOL,
  EMBED_TOOL,
  EMBEDDINGS_DESCRIBE_TOOL,
  EMBED_COMPARE_TOOL_DESCRIPTION,
  EMBED_TOOL_DESCRIPTION,
  EMBEDDINGS_DESCRIBE_TOOL_DESCRIPTION,
  embedCompareParameters,
  embedParameters,
  embeddingsDescribeParameters,
} from './tool-contracts.js';

const require = createRequire(import.meta.url);
const manifest: unknown = require('../package.json');
const version =
  typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string'
    ? manifest.version
    : '0.0.0';

export const embeddingsMcpServerInfo = { name: 'pi-embeddings', version };

export interface EmbeddingsMcpServerOptions {
  cwd?: string | undefined;
  settings?: EmbeddingSettings;
  /** Project settings are never read unless the host explicitly asserts trust. */
  projectTrusted?: boolean;
  runtime?: EmbeddingsRuntime;
  info?: { name: string; version: string };
}

const errorResult = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

const jsonResult = (value: object, text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: { result: value },
});

const isRequest = (value: unknown): value is EmbeddingRequest =>
  Value.Check(embeddingRequestSchema, value);

const validationProblems = (schema: TSchema, args: unknown): string[] => {
  if (Value.Check(schema, args)) return [];
  const problems = new Set<string>();
  for (const issue of Value.Errors(schema, args)) {
    if (issue.keyword === 'boolean') continue;
    const path = issue.instancePath === '' ? 'arguments' : issue.instancePath;
    const extra = (issue.params as { additionalProperties?: string[] }).additionalProperties;
    problems.add(
      extra === undefined
        ? `${path}: ${issue.message ?? 'invalid value'}`
        : `${path}: unknown or server-owned properties ${extra.join(', ')}`
    );
  }
  return [...problems];
};

/** Trusted host attribution is read only from namespaced MCP metadata, never from model arguments. */
function readContext(request: unknown): EmbeddingContext | undefined {
  if (typeof request !== 'object' || request === null || !('params' in request))
    throw new EmbeddingsError('configuration-invalid');
  const requestParams = (request as { params: unknown }).params;
  if (typeof requestParams !== 'object' || requestParams === null)
    throw new EmbeddingsError('configuration-invalid');
  const params: Record<string, unknown> = { ...requestParams };
  const meta = params['_meta'];
  if (meta === undefined) return undefined;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta))
    throw new EmbeddingsError('configuration-invalid');
  const namespaced = (meta as Record<string, unknown>)[EMBEDDING_CONTEXT_META_KEY];
  if (namespaced === undefined) return undefined;
  if (!Value.Check(embeddingContextSchema, namespaced))
    throw new EmbeddingsError('configuration-invalid');
  return namespaced;
}

const summary = (result: {
  outcomes: readonly { readonly status: string; readonly route?: string; readonly model?: string }[];
}): string => {
  const successes = result.outcomes.filter((outcome) => outcome.status === 'success');
  const errors = result.outcomes.length - successes.length;
  const routes = [
    ...new Set(successes.map((outcome) => `${outcome.route}:${outcome.model}`)),
  ].join(', ');
  return `Embedded ${successes.length}/${result.outcomes.length} input(s)${routes === '' ? '' : ` via ${routes}`}${errors === 0 ? '' : `; ${errors} failed`}.`;
};

/**
 * Create one MCP server around a package-owned runtime. The caller owns transport, the returned
 * server, and runtime shutdown; closing a session never closes the shared runtime.
 */
export async function createEmbeddingsMcpServer(
  options: EmbeddingsMcpServerOptions = {}
): Promise<Server> {
  const ownsRuntime = options.runtime === undefined;
  const runtime =
    options.runtime ??
    createEmbeddingsRuntime({
      settings: options.settings ?? loadEmbeddingSettings(options.cwd ?? process.cwd(), options.projectTrusted ?? false),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
  await runtime.start();

  const server = new Server(options.info ?? embeddingsMcpServerInfo, {
    capabilities: { tools: {} },
    instructions:
      'Independent pi-embeddings MCP server. Provider, model and credentials stay on the server and cannot be overridden by tool arguments. Vectors are returned in structuredContent.result. Comparison runs only on explicit request and may incur multiple charges.',
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: EMBED_TOOL,
        description: EMBED_TOOL_DESCRIPTION,
        inputSchema: embedParameters,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      {
        name: EMBED_COMPARE_TOOL,
        description: EMBED_COMPARE_TOOL_DESCRIPTION,
        inputSchema: embedCompareParameters,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      {
        name: EMBEDDINGS_DESCRIBE_TOOL,
        description: EMBEDDINGS_DESCRIBE_TOOL_DESCRIPTION,
        inputSchema: embeddingsDescribeParameters,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = request.params.arguments ?? {};
    try {
      switch (request.params.name) {
        case EMBED_TOOL:
        case EMBED_COMPARE_TOOL: {
          const problems = validationProblems(embeddingRequestSchema, args);
          if (problems.length > 0)
            return errorResult(`Invalid arguments for ${request.params.name}:\n- ${problems.join('\n- ')}`);
          if (!isRequest(args)) return errorResult('Invalid embedding request.');
          const context = readContext(request);
          if (request.params.name === EMBED_TOOL) {
            const result = await runtime.embed(args, { signal: extra.signal, context });
            return jsonResult(result, summary(result));
          }
          const compared = await runtime.compare(args, { signal: extra.signal, context });
          return jsonResult(compared, `Compared ${compared.entries.length} configured embedding route(s).`);
        }
        case EMBEDDINGS_DESCRIBE_TOOL: {
          const problems = validationProblems(embeddingsDescribeParameters, args);
          if (problems.length > 0)
            return errorResult(`Invalid arguments for ${request.params.name}:\n- ${problems.join('\n- ')}`);
          const described = runtime.describe();
          return jsonResult(
            described,
            `Embedding route ${described.selected.provider}/${described.selected.model}; ready: ${described.ready}.`
          );
        }
        default:
          throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      const code = error instanceof EmbeddingsError ? error.code : 'configuration-invalid';
      return errorResult(`${request.params.name} failed: ${code}`);
    }
  });

  if (ownsRuntime) {
    let ownClosed = false;
    const closeServer = server.close.bind(server);
    const wrapped = server as Server & { close: () => Promise<void> };
    wrapped.close = async () => {
      if (ownClosed) return;
      ownClosed = true;
      await closeServer();
      await runtime.close();
    };
  }
  return server;
}
