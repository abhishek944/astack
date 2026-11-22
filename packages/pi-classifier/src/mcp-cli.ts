#!/usr/bin/env node
// pi-classifier-mcp: serves the classifier tools over MCP stdio. stdout carries
// only JSON-RPC, so every diagnostic goes to stderr.

import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClassifierMcpServer } from './mcp-server.js';

const require = createRequire(import.meta.url);
const manifest: unknown = require('../package.json');
const version =
  typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string'
    ? manifest.version
    : '0.0.0';

// Keep stray dependency output off the JSON-RPC stream.
console.log = console.info = console.debug = console.error;

const server = createClassifierMcpServer({ cwd: process.cwd(), info: { name: 'pi-classifier', version } });
const transport = new StdioServerTransport();

let closing = false;
async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await server.close();
  } catch (error) {
    console.error('pi-classifier-mcp: error during shutdown:', error);
  }
  process.exit(code);
}

process.stdin.once('end', () => void shutdown(0));
process.stdin.once('close', () => void shutdown(0));
process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

try {
  await server.connect(transport);
} catch (error) {
  console.error('pi-classifier-mcp: failed to start:', error);
  process.exit(1);
}
