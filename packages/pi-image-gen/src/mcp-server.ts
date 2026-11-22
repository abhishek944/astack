// Independent MCP server for the image-generation package. Tool behavior stays
// in the owning package's core functions; this module only lists tools,
// validates arguments at the MCP boundary, forwards cancellation, and maps
// results to MCP content.

import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { compareImages } from './compare.js';
import { loadImageGenSettings } from './config.js';
import { errorMessageForUser } from './errors.js';
import { generateImage } from './generate.js';
import {
  buildImageMcpToolDefinitions,
  validateMcpToolArguments,
  type ImageMcpToolName,
} from './mcp-tool-definitions.js';
import { imageSearchErrorMessage } from './search/errors.js';
import { loadImageSearchSettings } from './search/config.js';
import { compareImageSearches, searchImages } from './search/search.js';
import type { ImageSearchSettings } from './search/types.js';
import { runSpritePipeline } from './sprite/pipeline.js';
import { normalizeSpriteSettings } from './sprite/settings.js';
import type { CompareImageParams, GenerateImageParams, ImageGenResult, ImageGenSettings } from './types.js';
import type { SpriteGenerateParams } from './sprite/types.js';

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface ImageMcpServerOptions {
  /** Directory for relative input/output paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Preloaded settings; otherwise read by the owning package. */
  settings?: ImageGenSettings;
  /** Preloaded image-search settings; otherwise read by the owning package. */
  searchSettings?: ImageSearchSettings;
  /** Project settings are not loaded unless the caller supplies trust explicitly. */
  projectTrusted?: boolean;
  /** Optional allowlist of MCP tool names. */
  enabledTools?: readonly ImageMcpToolName[];
  info?: McpServerInfo;
}

const require = createRequire(import.meta.url);
const manifest: unknown = require('../package.json');
const packageVersion =
  typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string'
    ? manifest.version
    : '0.0.0';

export const imageMcpServerInfo: McpServerInfo = {
  name: 'pi-image-gen',
  version: packageVersion,
};

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function jsonResult(value: object, prefix?: string): CallToolResult {
  const text = prefix ? `${prefix}\n\n${JSON.stringify(value, null, 2)}` : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: { result: value } };
}

function imageResultText(result: ImageGenResult): string {
  const paths = result.images.map((image) => `  ${image.path}`).join('\n');
  return `Generated ${result.images.length} image(s) via ${result.provider} (${result.model}).\nSaved files:\n${paths}`;
}

/** Create an MCP Server. The CLI connects it to stdio; embedders own any other transport. */
export function createImageMcpServer(options: ImageMcpServerOptions = {}): Server {
  const cwd = options.cwd ?? process.cwd();
  const settings = options.settings ?? loadImageGenSettings(cwd, options.projectTrusted ?? false);
  const searchSettings = options.searchSettings ?? loadImageSearchSettings(cwd, options.projectTrusted ?? false);
  const spriteEnabled = normalizeSpriteSettings(settings.spriteGeneration).enabled;
  const allTools = buildImageMcpToolDefinitions(spriteEnabled);
  const enabled = options.enabledTools;
  const tools = enabled === undefined
    ? allTools
    : allTools.filter((tool) => enabled.includes(tool.name));

  const server = new Server(options.info ?? imageMcpServerInfo, {
    capabilities: { tools: {} },
    instructions:
      'Independent pi-image-gen MCP server. Provider settings and credentials stay on the server; relative paths resolve against the server process cwd. Generation, comparison and search calls may incur charges.',
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const tool = tools.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);

    const args = request.params.arguments ?? {};
    const problems = validateMcpToolArguments(tool, args);
    if (problems.length > 0) return errorResult(`Invalid arguments for ${name}:\n- ${problems.join('\n- ')}`);

    const signal = extra.signal;
    try {
      switch (tool.name) {
        case 'image_generate': {
          const result = await generateImage(args as GenerateImageParams, {
            cwd,
            settings,
            ...(signal ? { signal } : {}),
          });
          return jsonResult(result, imageResultText(result));
        }
        case 'image_compare': {
          const result = await compareImages(args as CompareImageParams, {
            cwd,
            settings,
            ...(signal ? { signal } : {}),
          });
          const succeeded = result.entries.some((entry) => entry.status === 'success');
          const response = jsonResult(result, `Image comparison: ${result.entries.filter((entry) => entry.status === 'success').length}/${result.entries.length} routes succeeded.`);
          if (!succeeded) response.isError = true;
          return response;
        }
        case 'image_search': {
          const result = await searchImages(args as Parameters<typeof searchImages>[0], {
            cwd,
            settings: searchSettings,
            ...(signal ? { signal } : {}),
          });
          return jsonResult(result, `Image search via ${result.provider}: ${result.images.length} validated image(s).`);
        }
        case 'image_search_compare': {
          const result = await compareImageSearches(args as Parameters<typeof compareImageSearches>[0], {
            cwd,
            settings: searchSettings,
            ...(signal ? { signal } : {}),
          });
          const succeeded = result.entries.some((entry) => entry.status === 'success');
          const response = jsonResult(result, `Image search comparison: ${result.entries.length} configured provider(s).`);
          if (!succeeded) response.isError = true;
          return response;
        }
        case 'sprite_generate': {
          const result = await runSpritePipeline(args as SpriteGenerateParams, {
            cwd,
            settings,
            ...(signal ? { signal } : {}),
          });
          return jsonResult(result, `Sprite generation produced ${result.frames.length} frame(s).`);
        }
        default: {
          const exhaustive: never = tool.name;
          return errorResult(`Unhandled tool: ${exhaustive}`);
        }
      }
    } catch (error) {
      const message = tool.name.startsWith('image_search')
        ? imageSearchErrorMessage(error)
        : errorMessageForUser(error);
      return errorResult(`${tool.name} failed: ${message}`);
    }
  });

  return server;
}

export {
  buildImageMcpToolDefinitions,
  validateMcpToolArguments,
  type ImageMcpToolDefinition,
  type ImageMcpToolName,
} from './mcp-tool-definitions.js';
