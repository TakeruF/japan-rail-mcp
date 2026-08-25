import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultService } from '../src/app.js';
import { createServer } from '../src/server.js';

function parseText(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error('Expected MCP content.');
  }
  const content = result.content;
  if (!Array.isArray(content)) throw new Error('Expected content array.');
  const first = content[0];
  if (!first || typeof first !== 'object' || !('text' in first) || typeof first.text !== 'string') {
    throw new Error('Expected text content.');
  }
  return JSON.parse(first.text) as unknown;
}

describe('MCP server contracts', () => {
  let server: ReturnType<typeof createServer>;
  let client: Client;

  beforeEach(async () => {
    server = createServer(createDefaultService({}));
    client = new Client({ name: 'japan-rail-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await Promise.all([client.close(), server.close()]);
  });

  it('advertises every tool as read-only and separates journeys from trains', async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'get_provider_status',
      'search_stations',
      'search_trains',
      'get_train_details',
      'get_availability',
      'compare_trains',
      'search_journeys',
    ]);
    expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(result.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);
    expect(result.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
  });

  it('returns machine-readable structured station candidates', async () => {
    const result = await client.callTool({
      name: 'search_stations',
      arguments: { query: 'Osaka' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      stations: expect.arrayContaining([
        expect.objectContaining({ id: 'jp:station:osaka' }),
        expect.objectContaining({ id: 'jp:station:shin-osaka' }),
      ]),
    });
  });

  it('returns a structured unsupported error instead of a fixture timetable', async () => {
    const result = await client.callTool({
      name: 'search_trains',
      arguments: {
        fromStationId: 'jp:station:tokyo',
        toStationId: 'jp:station:shin-osaka',
        date: '2026-08-26',
      },
    });
    expect(result.isError).toBe(true);
    expect(parseText(result)).toMatchObject({ code: 'UNSUPPORTED_FEATURE' });
    expect(result.structuredContent).toBeUndefined();
  });

  it('keeps availability as an explicit supported tool contract', async () => {
    const result = await client.callTool({
      name: 'get_availability',
      arguments: {
        trainId: 'opaque',
        fromStationId: 'jp:station:tokyo',
        toStationId: 'jp:station:shin-osaka',
        date: '2026-08-26',
      },
    });
    expect(result.structuredContent).toMatchObject({ status: 'unsupported' });
  });
});
