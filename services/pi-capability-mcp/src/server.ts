import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type Server as HttpServer, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Value } from "typebox/value";
import { serviceInfo, serverInstructions } from "./adapters.js";
import { authenticate } from "./auth.js";
import type { CapabilityAdapters, CapabilityTool } from "./catalog.js";
import type { Principal, ServiceConfig } from "./config.js";
import type { CapabilityRuntime } from "./queue.js";

const requestSignalStorage = new AsyncLocalStorage<AbortSignal>();

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function combineSignals(first: AbortSignal | undefined, second: AbortSignal | undefined): AbortSignal | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  const controller = new AbortController();
  const abort = (reason: unknown): void => controller.abort(reason);
  for (const signal of [first, second]) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function validateArguments(tool: CapabilityTool, args: unknown): string[] {
  if (Value.Check(tool.inputSchema, args)) return [];
  const problems: string[] = [];
  for (const problem of Value.Errors(tool.inputSchema, args)) {
    problems.push(`${problem.instancePath || "arguments"}: ${problem.message}`);
  }
  return problems.length > 0 ? problems : ["arguments do not match the tool schema"];
}

function createMcpServer(
  principal: Principal,
  tools: readonly CapabilityTool[],
  runtime: CapabilityRuntime,
): Server {
  const allowed = tools.filter((tool) => principal.tools.has(tool.name));
  const byName = new Map(allowed.map((tool) => [tool.name, tool]));
  const server = new Server(serviceInfo, {
    capabilities: { tools: {} },
    instructions: serverInstructions,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allowed.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name } = request.params;
    const tool = byName.get(name);
    if (tool === undefined) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown or unauthorized tool: ${name}`);
    }

    const args: unknown = request.params.arguments ?? {};
    const problems = validateArguments(tool, args);
    if (problems.length > 0) {
      return errorResult(`Invalid arguments for ${name}:\n- ${problems.join("\n- ")}`);
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      return errorResult(`Invalid arguments for ${name}: expected an object`);
    }

    const rawArgs = args as Record<string, unknown>;
    const idempotencyValue = rawArgs.idempotencyKey;
    const idempotencyKey = typeof idempotencyValue === "string" && idempotencyValue.trim() !== ""
      ? idempotencyValue
      : undefined;
    if (tool.paid && idempotencyKey === undefined) {
      return errorResult(`${name} is a paid capability and requires an idempotencyKey argument`);
    }

    const cleanArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawArgs)) {
      if (key !== "idempotencyKey") cleanArgs[key] = value;
    }

    try {
      return await runtime.submit({
        toolName: tool.name,
        family: tool.family,
        paid: tool.paid,
        principalId: principal.id,
        args: cleanArgs,
        idempotencyKey,
      }, combineSignals(extra.signal, requestSignalStorage.getStore()));
    } catch (error) {
      return errorResult(`${name} failed: ${errorMessage(error)}`);
    }
  });

  return server;
}

interface Session {
  readonly server: Server;
  readonly transport: StreamableHTTPServerTransport;
  readonly principal: Principal;
}

interface HeldResponse {
  readonly response: ServerResponse;
  readonly controller: AbortController;
  readonly timer: NodeJS.Timeout;
}

export interface HttpSurface {
  readonly http: HttpServer;
  close(): Promise<void>;
}

/**
 * Stateful streamable HTTP is used deliberately: the installed MCP SDK routes
 * notifications/cancelled to the matching request handler only within one
 * server instance. This adds internal transport state, not an external job
 * receipt or polling API. Every POST re-authenticates its runtime token.
 */
export function createHttpSurface(
  config: ServiceConfig,
  adapters: CapabilityAdapters,
  runtime: CapabilityRuntime,
): HttpSurface {
  const sessions = new Map<string, Session>();
  const held = new Map<ServerResponse, HeldResponse>();
  let closing = false;

  const trackResponse = (response: ServerResponse): HeldResponse => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (response.writableEnded) return;
      controller.abort(new Error("MCP response deadline exceeded"));
      if (!response.headersSent) response.writeHead(504);
      response.end("MCP response deadline exceeded");
    }, config.httpRequestTimeoutMs);
    const heldResponse: HeldResponse = { response, controller, timer };
    held.set(response, heldResponse);
    response.once("close", () => {
      clearTimeout(timer);
      held.delete(response);
      controller.abort();
    });
    return heldResponse;
  };

  const handle = (session: Session, request: Parameters<StreamableHTTPServerTransport["handleRequest"]>[0], response: Parameters<StreamableHTTPServerTransport["handleRequest"]>[1]): void => {
    const heldResponse = trackResponse(response);
    void requestSignalStorage.run(heldResponse.controller.signal, async () => {
      try {
        await session.transport.handleRequest(request, response);
      } catch (error) {
        if (!response.headersSent) response.writeHead(500).end("MCP request failed");
        else if (!response.destroyed) response.end();
        process.stderr.write(`${JSON.stringify({ event: "mcp.request_failed", message: errorMessage(error) })}\n`);
      }
    });
  };

  const http = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");

    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    if (closing) {
      response.writeHead(503).end("Service is stopping");
      return;
    }
    if (request.url !== "/" && request.url !== "/mcp") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (request.method !== "POST" && request.method !== "DELETE") {
      response.setHeader("Allow", "POST, DELETE");
      response.writeHead(405).end("Only POST and DELETE are supported");
      return;
    }

    const principal = authenticate(request.headers.authorization, config.tokens);
    if (principal === undefined) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="pi-capability-mcp"');
      response.writeHead(401).end("A valid runtime bearer token is required");
      return;
    }

    const headerSession = request.headers["mcp-session-id"];
    const sessionId = Array.isArray(headerSession) ? headerSession[0] : headerSession;
    if (sessionId !== undefined) {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        response.writeHead(404).end("MCP session not found");
        return;
      }
      if (session.principal.id !== principal.id) {
        response.writeHead(403).end("MCP session belongs to a different runtime token");
        return;
      }
      handle(session, request, response);
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(400).end("A session header is required for DELETE");
      return;
    }

    const server = createMcpServer(principal, adapters.tools, runtime);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport, principal });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        void server.close().catch(() => undefined);
      },
    });
    void (async () => {
      try {
        await server.connect(transport);
        handle({ server, transport, principal }, request, response);
      } catch (error) {
        if (!response.headersSent) response.writeHead(500).end("MCP connect failed");
        else if (!response.destroyed) response.end();
        process.stderr.write(`${JSON.stringify({ event: "mcp.connect_failed", message: errorMessage(error) })}\n`);
      }
    })();
  });

  // Bounds receipt of the request body; the response deadline above bounds the held call.
  http.requestTimeout = config.httpRequestTimeoutMs;

  return {
    http,
    async close() {
      closing = true;
      for (const heldResponse of held.values()) {
        clearTimeout(heldResponse.timer);
        heldResponse.controller.abort();
        const { response } = heldResponse;
        if (!response.writableEnded && !response.destroyed) {
          if (!response.headersSent) response.writeHead(503);
          response.end("Service is stopping");
        }
      }
      held.clear();
      const openSessions = [...sessions.values()];
      sessions.clear();
      await Promise.all(openSessions.map((session) => session.server.close().catch(() => undefined)));
      await new Promise<void>((resolve, reject) => {
        http.close((error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}
