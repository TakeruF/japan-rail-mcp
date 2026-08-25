#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDefaultService } from './app.js';
import { createServer } from './server.js';

const server = createServer(createDefaultService());
const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  console.error('Failed to start japan-rail-mcp:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
