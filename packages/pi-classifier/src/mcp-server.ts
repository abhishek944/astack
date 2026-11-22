// Independent MCP server for the classifier package. Tool behavior stays in
// the owning package's core functions; this module only lists tools, validates
// arguments at the MCP boundary, forwards cancellation, and maps results to
// MCP content.

import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { CredentialSource } from './auth.js';
import { renderClassifierBox } from './box.js';
import { classify, compareClassifiers } from './classify.js';
import { loadClassifierSettings } from './config.js';
import { extract } from './extract.js';
import {
  CLASSIFIER_BOX_TOOL,
  CLASSIFY_COMPARE_TOOL,
  CLASSIFY_EXTRACT_TOOL,
  CLASSIFY_TOOL,
  CLASSIFY_TREE_TOOL,
} from './tool-contracts.js';
import { classifyTree } from './tree.js';
import { userError, type ClassifierSettings } from './types.js';
import {
  CLASSIFIER_MCP_TOOL_DEFINITIONS,
  validateMcpToolArguments,
  type ClassifierMcpToolName,
} from './mcp-tool-definitions.js';

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface ClassifierMcpServerOptions {
  /** Directory for relative image, media, tree and output paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Preloaded settings; otherwise read by the owning package. */
  settings?: ClassifierSettings;
  /** Project settings are not loaded unless the caller supplies trust explicitly. */
  projectTrusted?: boolean;
  /**
   * Credential origin. The standalone server defaults to explicit provider keys
   * so a non-Pi MCP client cannot silently use Pi chat login credentials.
   */
  credentialSource?: CredentialSource;
  /** Optional allowlist of MCP tool names. */
  enabledTools?: readonly ClassifierMcpToolName[];
  info?: McpServerInfo;
}

const require = createRequire(import.meta.url);
const manifest: unknown = require('../package.json');
const packageVersion =
  typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string'
    ? manifest.version
    : '0.0.0';

export const classifierMcpServerInfo: McpServerInfo = {
  name: 'pi-classifier',
  version: packageVersion,
};

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function jsonResult(value: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  };
}

/** Create an MCP Server. The CLI connects it to stdio; embedders own any other transport. */
export function createClassifierMcpServer(options: ClassifierMcpServerOptions = {}): Server {
  const cwd = options.cwd ?? process.cwd();
  const settings = options.settings ?? loadClassifierSettings(cwd, options.projectTrusted ?? false);
  const credentialSource = options.credentialSource ?? 'explicit';
  const enabled = options.enabledTools;
  const tools = enabled === undefined
    ? CLASSIFIER_MCP_TOOL_DEFINITIONS
    : CLASSIFIER_MCP_TOOL_DEFINITIONS.filter((tool) => enabled.includes(tool.name));

  const server = new Server(options.info ?? classifierMcpServerInfo, {
    capabilities: { tools: {} },
    instructions:
      'Independent pi-classifier MCP server. Provider routes and credentials stay on the server; relative paths resolve against the server process cwd. Classification and comparison calls may incur charges and send supplied state to the configured provider.',
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
    const requestOptions = {
      settings,
      cwd,
      credentialSource,
      ...(signal ? { signal } : {}),
    };

    try {
      switch (tool.name) {
        case CLASSIFY_TOOL:
          return jsonResult(await classify(args, requestOptions));
        case CLASSIFY_COMPARE_TOOL:
          return jsonResult(await compareClassifiers(args, requestOptions));
        case CLASSIFY_TREE_TOOL:
          return jsonResult(await classifyTree(args, requestOptions));
        case CLASSIFY_EXTRACT_TOOL:
          return jsonResult(await extract(args, requestOptions));
        case CLASSIFIER_BOX_TOOL: {
          const result = await renderClassifierBox(args, {
            cwd,
            ...(signal ? { signal } : {}),
          });
          const byteLength = Buffer.from(result.data, 'base64').byteLength;
          const details = {
            mode: result.mode,
            mimeType: result.mimeType,
            width: result.width,
            height: result.height,
            pixelBox: result.pixelBox,
            byteLength,
          };
          return {
            content: [
              {
                type: 'text',
                text:
                  `Rendered ${result.mode} box as a ${result.width}×${result.height} PNG ` +
                  `(${byteLength} bytes). Source pixel box: left=${result.pixelBox.left}, ` +
                  `top=${result.pixelBox.top}, width=${result.pixelBox.width}, ` +
                  `height=${result.pixelBox.height}. A box is a localization hint, not proof that the object exists.`,
              },
              { type: 'image', data: result.data, mimeType: result.mimeType },
            ],
            structuredContent: { result: details },
          };
        }
        default: {
          const exhaustive: never = tool.name;
          return errorResult(`Unhandled tool: ${exhaustive}`);
        }
      }
    } catch (error) {
      return errorResult(`${tool.name} failed: ${userError(error)}`);
    }
  });

  return server;
}

export {
  CLASSIFIER_MCP_TOOL_DEFINITIONS,
  validateMcpToolArguments,
  type ClassifierMcpToolDefinition,
  type ClassifierMcpToolName,
} from './mcp-tool-definitions.js';
