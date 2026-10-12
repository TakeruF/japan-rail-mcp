import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import {
  loadPersonalPreferences,
  personalInputSchema,
  preferencesSchema,
  resolvePersonalConstraints,
} from '../src/core/preferences.js';
import { EkispertProvider } from '../src/providers/ekispert.js';
import { StaticShinkansenStationProvider } from '../src/providers/static/station-provider.js';
import { RailService } from '../src/services/rail-service.js';
import { createServer } from '../src/server.js';

const prefs = preferencesSchema.parse({
  defaults: {
    boardingBufferMinutes: 10,
    exitBufferMinutes: 5,
    maxFareJPY: 14000,
    seatClassId: 'reserved',
  },
  stations: {
    'jp:station:tokyo': { boardingBufferMinutes: 15, exitBufferMinutes: 99 },
    'jp:station:shin-osaka': { exitBufferMinutes: 8, boardingBufferMinutes: 99 },
  },
});
const origin = 'jp:station:tokyo';
const destination = 'jp:station:shin-osaka';

describe('Saved personal preferences and one-call planning', () => {
  it('applies directional station values, explicit zero, and nullable overrides', () => {
    const saved = resolvePersonalConstraints(
      personalInputSchema.parse({ stationReadyAt: '2026-08-26T11:50:00+09:00' }),
      prefs,
      origin,
      destination,
    );
    expect(saved).toMatchObject({
      boardingBufferMinutes: 15,
      exitBufferMinutes: 8,
      maxFareJPY: 14000,
      seatClassId: 'reserved',
    });
    const overrides = resolvePersonalConstraints(
      personalInputSchema.parse({
        stationReadyAt: saved.stationReadyAt,
        boardingBufferMinutes: 0,
        exitBufferMinutes: 0,
        maxFareJPY: null,
        seatClassId: null,
      }),
      prefs,
      origin,
      destination,
    );
    expect(overrides).toEqual({
      stationReadyAt: saved.stationReadyAt,
      boardingBufferMinutes: 0,
      exitBufferMinutes: 0,
    });
    expect(prefs.defaults.maxFareJPY).toBe(14000);
  });

  it('loads a persisted JSON file and fails closed for missing or invalid explicit files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'japan-rail-preferences-'));
    const path = join(directory, 'preferences.json');
    const env = { JAPAN_RAIL_PREFERENCES_FILE: path };
    try {
      expect(() => loadPersonalPreferences(env)).toThrow('Cannot read');
      writeFileSync(path, JSON.stringify(prefs));
      expect(loadPersonalPreferences(env)).toEqual(prefs);
      writeFileSync(path, '{');
      expect(() => loadPersonalPreferences(env)).toThrow('valid JSON');
      writeFileSync(path, JSON.stringify({ defaults: { boardingBufferMinutes: -1 } }));
      expect(() => loadPersonalPreferences(env)).toThrow('preferences schema');
      writeFileSync(path, JSON.stringify({ defaults: { typo: 20 } }));
      expect(() => loadPersonalPreferences(env)).toThrow('preferences schema');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('searches once through MCP using saved station buffers and supports offline re-evaluation', async () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../fixtures/ekispert-shinkansen-course.json', import.meta.url), 'utf8'),
    ) as unknown;
    const now = () => new Date('2026-08-25T04:00:00Z');
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      void input;
      return Response.json(fixture);
    });
    const stations = new StaticShinkansenStationProvider();
    const service = new RailService(
      stations,
      new EkispertProvider(stations, { apiKey: 'test-key', now, fetch }),
      now,
      prefs,
    );
    const server = createServer(service);
    const client = new Client({ name: 'saved-preferences-test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      const preferences = await client.callTool({
        name: 'get_personal_preferences',
        arguments: {},
      });
      expect(preferences.structuredContent).toEqual(prefs);
      expect(fetch).not.toHaveBeenCalled();
      const result = await client.callTool({
        name: 'plan_shinkansen_trip',
        arguments: {
          fromStationId: origin,
          toStationId: destination,
          stationReadyAt: '2026-08-26T02:40:00Z',
          arriveBy: '2026-08-26T16:00:00+09:00',
          maxFareJPY: 15000,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.structuredContent as { feasible: { trainId: string }[] };
      expect(result.structuredContent).toMatchObject({
        dataMode: 'provider_search',
        considered: 2,
        constraints: {
          boardingBufferMinutes: 15,
          exitBufferMinutes: 8,
          maxFareJPY: 15000,
          seatClassId: 'reserved',
        },
      });
      expect(content.feasible).toHaveLength(2);
      expect(fetch).toHaveBeenCalledTimes(1);
      const request = fetch.mock.calls[0]![0];
      const url = new URL(request instanceof Request ? request.url : request);
      expect(url.searchParams.get('date')).toBe('20260826');
      expect(url.searchParams.get('time')).toBe('1155');
      const revised = await client.callTool({
        name: 'evaluate_train_options',
        arguments: {
          trainIds: content.feasible.map((option) => option.trainId),
          stationReadyAt: '2026-08-26T11:40:00+09:00',
          maxFareJPY: null,
          seatClassId: null,
          boardingBufferMinutes: 0,
        },
      });
      expect(revised.isError).not.toBe(true);
      expect(revised.structuredContent).toMatchObject({
        dataMode: 'saved_search_snapshot',
        constraints: { boardingBufferMinutes: 0, exitBufferMinutes: 8 },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('derives the next-day Japan search date when boarding allowance crosses midnight', async () => {
    const now = () => new Date('2026-08-25T04:00:00Z');
    const fetch = vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0]) =>
      Response.json({ ResultSet: {} }),
    );
    const stations = new StaticShinkansenStationProvider();
    const service = new RailService(
      stations,
      new EkispertProvider(stations, { apiKey: 'test-key', now, fetch }),
      now,
    );
    const result = await service.planShinkansenTrip({
      fromStationId: origin,
      toStationId: destination,
      stationReadyAt: '2026-08-26T23:55:00+09:00',
    });
    const request = fetch.mock.calls[0]![0];
    const url = new URL(request instanceof Request ? request.url : request);
    expect(url.searchParams.get('date')).toBe('20260827');
    expect(url.searchParams.get('time')).toBe('0005');
    expect(result.considered).toBe(0);
    expect(result.dataMode).toBe('provider_search');
    await expect(
      service.planShinkansenTrip({
        fromStationId: origin,
        toStationId: destination,
        stationReadyAt: '2026-08-26T12:00:00+09:00',
        arriveBy: '2026-08-26T12:05:00+09:00',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TIME' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
