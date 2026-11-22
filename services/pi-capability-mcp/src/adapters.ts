import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { classify, classifyTree, compareClassifiers } from "@abhishek944/pi-classifier";
import { compareImages, generateImage, runSpritePipeline } from "@abhishek944/pi-image-gen";
import type { CompareImageParams, GenerateImageParams, SpriteGenerateParams } from "@abhishek944/pi-image-gen";
import {
  compareImageSearches,
  searchImages,
} from "@abhishek944/pi-image-gen/search";
import type { ImageSearchParams } from "@abhishek944/pi-image-gen/search";
import {
  formatComparisonText,
  formatSpriteToolResult,
  formatToolResultText,
} from "@abhishek944/pi-image-gen/extension";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "typebox";
import {
  capabilityTool,
  createStaticTools,
  omitIdempotencyKey,
  type CapabilityAdapters,
  type CapabilityExecutor,
  type CapabilityTool,
} from "./catalog.js";
import type { ServiceConfig } from "./config.js";

function textResult(text: string, details?: unknown): CallToolResult {
  if (details === undefined) return { content: [{ type: "text", text }] };
  return {
    content: [{ type: "text", text }],
    structuredContent: { result: details },
  };
}

function withSignal(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function serverOwnedOutput(args: Record<string, unknown>, cwd: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== "outputDir") result[key] = value;
  }
  result.outputDir = cwd;
  return result;
}

function stripSearchControls(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== "expectedProvider" && key !== "includeBytes") result[key] = value;
  }
  return result;
}

function createImageExecutors(config: ServiceConfig): Record<string, CapabilityExecutor> {
  const cwd = config.workingDirectory;

  return {
    sprite_generate: async (args, signal) => {
      const result = await runSpritePipeline(serverOwnedOutput(args, cwd) as SpriteGenerateParams, {
        cwd,
        settings: config.imageSettings,
        retainPartialOutputs: true,
        ...withSignal(signal),
      });
      return textResult(formatSpriteToolResult(result, (path) => encodeURI(path)), result);
    },
    image_generate: async (args, signal) => {
      const result = await generateImage(serverOwnedOutput(args, cwd) as GenerateImageParams, {
        cwd,
        settings: config.imageSettings,
        retainPartialOutputs: true,
        ...withSignal(signal),
      });
      return textResult(formatToolResultText(result), result);
    },
    image_compare: async (args, signal) => {
      const result = await compareImages(serverOwnedOutput(args, cwd) as CompareImageParams, {
        cwd,
        settings: config.imageSettings,
        retainPartialOutputs: true,
        ...withSignal(signal),
      });
      return textResult(formatComparisonText(result), result);
    },
    image_search: async (args, signal) => {
      const expected = args.expectedProvider;
      if (typeof expected === "string" && config.imageSearchSettings.default?.provider !== expected)
        throw new Error(`Configured image search provider differs from the frozen provider: ${expected}`);
      const includeBytes = args.includeBytes === true;
      const result = await searchImages(
        serverOwnedOutput(stripSearchControls(args), cwd) as ImageSearchParams,
        { cwd, settings: config.imageSearchSettings, ...withSignal(signal) },
      );
      if (typeof expected === "string" && result.provider !== expected)
        throw new Error(`Image search provider differs from the frozen provider: ${result.provider}`);
      const images = includeBytes
        ? await Promise.all(result.images.map(async (image) => {
          const file = image.originalPath ?? image.path;
          const local = relative(cwd, resolve(file));
          if (isAbsolute(local) || local === ".." || local.startsWith(".." + "/"))
            throw new Error("Image search returned a file outside the server directory.");
          const bytes = await readFile(file);
          return { ...image, bytesBase64: bytes.toString("base64") };
        }))
        : result.images;
      const publicResult = { ...result, images };
      return textResult(JSON.stringify(publicResult, null, 2), publicResult);
    },
    image_search_compare: async (args, signal) => {
      const result = await compareImageSearches(serverOwnedOutput(stripSearchControls(args), cwd) as ImageSearchParams, {
        cwd,
        settings: config.imageSearchSettings,
        ...withSignal(signal),
      });
      return textResult(JSON.stringify(result, null, 2), result);
    },
  };
}

type CompletionPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

type CompletionMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string | readonly CompletionPart[] };

type CompletionArgs = {
  readonly messages: readonly CompletionMessage[];
  readonly attribution: { readonly customer: string; readonly tags: readonly string[] };
  readonly expectedModel?: string;
};

const lineSafe = (value: string): boolean =>
  value !== "" && [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });

function createCompletionExecutors(config: ServiceConfig): Record<string, CapabilityExecutor> {
  const settings = config.completionSettings;
  if (settings === undefined) return {};
  return {
    capability_info: async () => {
      const info = {
        provider: settings.provider,
        model: settings.model,
        vision: settings.vision === true,
      };
      return textResult(JSON.stringify(info), info);
    },
    model_complete: async (rawArgs, signal) => {
      const args = rawArgs as unknown as CompletionArgs;
      if (!lineSafe(args.attribution.customer) || !args.attribution.tags.every(lineSafe))
        throw new Error("Completion attribution is unavailable for this request.");
      if (args.expectedModel !== undefined && args.expectedModel !== settings.model)
        throw new Error(`Completion model differs from the frozen model: ${settings.model}`);
      const sandbox = await mkdtemp(join(config.workingDirectory, "capability-completion-"));
      try {
        const modelsPath = join(sandbox, "models.json");
        const customerHeader = settings.customerHeader === undefined
          ? {}
          : { [settings.customerHeader]: args.attribution.customer };
        const document = {
          providers: {
            [settings.provider]: {
              name: settings.provider,
              baseUrl: settings.baseUrl,
              api: settings.api,
              apiKey: `\${${settings.apiKeyEnv}}`,
              headers: customerHeader,
              models: [
                {
                  id: settings.model,
                  name: settings.model,
                  reasoning: settings.reasoning ?? false,
                  input: settings.vision === true ? ["text", "image"] : ["text"],
                  contextWindow: settings.contextWindow,
                  maxTokens: settings.maxTokens,
                  samplingParams: {
                    user: args.attribution.customer,
                    metadata: { tags: [...args.attribution.tags] },
                  },
                  cost: {
                    input: settings.inputCostPerToken * 1_000_000,
                    output: settings.outputCostPerToken * 1_000_000,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                },
              ],
            },
          },
        };
        await writeFile(modelsPath, JSON.stringify(document), { mode: 0o600 });
        const runtime = await ModelRuntime.create({
          credentials: new InMemoryCredentialStore(),
          refreshOnCreate: false,
          allowModelNetwork: false,
          modelsPath,
        });
        await runtime.refresh({ providers: [settings.provider], allowNetwork: false });
        const model = runtime.getModel(settings.provider, settings.model);
        if (model === undefined) throw new Error(`Completion model ${settings.model} is unavailable.`);
        const systemPrompt = args.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        const now = Date.now();
        const response = await runtime.complete(
          model,
          {
            ...(systemPrompt === "" ? {} : { systemPrompt }),
            messages: args.messages
              .filter((message): message is Extract<CompletionMessage, { role: "user" }> => message.role === "user")
              .map((message) => ({
                role: "user" as const,
                content: typeof message.content === "string"
                  ? message.content
                  : message.content.map((part) => part.type === "text"
                    ? { type: "text" as const, text: part.text }
                    : { type: "image" as const, data: part.data, mimeType: part.mimeType }),
                timestamp: now,
              })),
          },
          { signal, maxRetries: 0 },
        );
        const text = response.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");
        const usage = {
          measured: response.usage.input + response.usage.cacheRead + response.usage.cacheWrite > 0 && response.usage.output > 0,
          inputTokens: response.usage.input + response.usage.cacheRead + response.usage.cacheWrite,
          outputTokens: response.usage.output,
          requests: 1,
          model: response.model,
        };
        return textResult(text, { text, usage, model: response.model, stopReason: response.stopReason });
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  };
}

function createClassifierExecutors(config: ServiceConfig): Record<string, CapabilityExecutor> {
  const options = {
    settings: config.classifierSettings,
    cwd: config.workingDirectory,
    credentialSource: "explicit" as const,
  };

  return {
    classify: async (args, signal) => {
      const result = await classify(args, { ...options, ...withSignal(signal) });
      return textResult(JSON.stringify(result, null, 2), result);
    },
    classify_compare: async (args, signal) => {
      const result = await compareClassifiers(args, { ...options, ...withSignal(signal) });
      return textResult(JSON.stringify(result, null, 2), result);
    },
    classify_tree: async (args, signal) => {
      const result = await classifyTree(args, { ...options, ...withSignal(signal) });
      return textResult(JSON.stringify(result, null, 2), result);
    },
  };
}

function childEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const WEB_OVERRIDE_KEYS: ReadonlySet<string> = new Set(["provider", "proxy"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Remove caller-selected providers and proxy endpoints from package-owned web schemas. */
function serverOwnedWebSchema(schema: TSchema): TSchema {
  if (!isRecord(schema) || !isRecord(schema.properties)) return schema;
  const properties: Record<string, unknown> = { ...schema.properties };
  for (const key of WEB_OVERRIDE_KEYS) delete properties[key];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string" && !WEB_OVERRIDE_KEYS.has(item))
    : schema.required;
  return { ...schema, properties, ...(required === undefined ? {} : { required }) } as TSchema;
}

function omitWebOverrides(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!WEB_OVERRIDE_KEYS.has(key)) result[key] = value;
  }
  return result;
}

async function createWebAdapter(config: ServiceConfig): Promise<CapabilityAdapters> {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("pi-web-access/package.json");
  const cliPath = join(dirname(packagePath), "dist", "mcp-cli.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath],
    env: childEnvironment(),
    stderr: "inherit",
  });
  const client = new Client(
    { name: "pi-capability-mcp-web-adapter", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: CapabilityTool[] = [];
  const executors: Record<string, CapabilityExecutor> = {};
  for (const tool of listed.tools) {
    const inputSchema = serverOwnedWebSchema(tool.inputSchema as TSchema);
    const paid = tool.name !== "get_search_content";
    tools.push(capabilityTool({
      name: tool.name,
      family: "web",
      description: tool.description ?? `pi-web-access tool ${tool.name}`,
      inputSchema,
      paid,
      annotations: tool.annotations ?? {},
    }));
    executors[tool.name] = async (args, signal) => {
      const result = await client.callTool(
        { name: tool.name, arguments: omitWebOverrides(omitIdempotencyKey(args)) },
        undefined,
        { signal, timeout: config.jobWaitTimeoutMs },
      );
      return result as CallToolResult;
    };
  }

  return {
    tools,
    executors,
    close: async () => {
      await client.close();
    },
  };
}

/** Compose the owning packages behind one capability catalog. No provider logic is reimplemented. */
export async function createProductionAdapters(config: ServiceConfig): Promise<CapabilityAdapters> {
  const web = await createWebAdapter(config);
  const executors: Record<string, CapabilityExecutor> = {
    ...createImageExecutors(config),
    ...createCompletionExecutors(config),
    ...createClassifierExecutors(config),
    ...web.executors,
  };
  const tools = [...createStaticTools(config), ...web.tools];
  return {
    tools,
    executors,
    close: web.close,
  };
}

export const serviceInfo = {
  name: "pi-capability-mcp",
  version: "0.1.0",
} as const;

export const serverInstructions =
  "Scoped capability tools backed by pi-image-gen, pi-web-access and pi-classifier. " +
  "Paid calls require an idempotencyKey. Provider settings and credentials stay on the server.";

