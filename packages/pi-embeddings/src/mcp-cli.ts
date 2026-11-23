#!/usr/bin/env node
// pi-embeddings-mcp: JSON-RPC only on stdout; all diagnostics go to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEmbeddingsRuntime } from './runtime.js';
import { loadEmbeddingSettings } from './settings.js';
import { createEmbeddingsMcpServer } from './mcp-server.js';
import type { EmbeddingsRuntime } from './runtime.js';

console.log = console.info = console.debug = console.error;

let closing = false;
let server: Awaited<ReturnType<typeof createEmbeddingsMcpServer>> | undefined;
let runtime: EmbeddingsRuntime | undefined;

const shutdown = async (code: number): Promise<void> => {
  if (closing) return;
  closing = true;
  try {
    await server?.close();
  } catch (error) {
    console.error('pi-embeddings-mcp: server close failed:', error instanceof Error ? error.message : 'unknown');
  }
  try {
    await runtime?.close();
  } catch (error) {
    console.error('pi-embeddings-mcp: runtime close failed:', error instanceof Error ? error.message : 'unknown');
  }
  process.exit(code);
};

process.stdin.once('end', () => void shutdown(0));
process.stdin.once('close', () => void shutdown(0));
process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

try {
  const cwd = process.cwd();
  runtime = createEmbeddingsRuntime({
    settings: loadEmbeddingSettings(cwd, false),
    cwd,
  });
  server = await createEmbeddingsMcpServer({ cwd, runtime });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(
    'pi-embeddings-mcp: failed to start:',
    error instanceof Error ? error.message : 'unknown'
  );
  await runtime?.close().catch(() => undefined);
  process.exit(1);
}
