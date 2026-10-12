import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { EkispertProvider, parseEkispertCourses } from '../src/providers/ekispert.js';
import { StaticShinkansenStationProvider } from '../src/providers/static/station-provider.js';
import { RailService } from '../src/services/rail-service.js';
import { evaluateTrainOptions, personalConstraintsSchema } from '../src/services/train-options.js';
import { createServer } from '../src/server.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/ekispert-shinkansen-course.json', import.meta.url), 'utf8'),
) as unknown;
const stations = new StaticShinkansenStationProvider();
const now = new Date('2026-08-25T04:00:00Z');
async function candidates() {
  return parseEkispertCourses(fixture, {
    from: await stations.getStation('jp:station:tokyo'),
    to: await stations.getStation('jp:station:shin-osaka'),
    date: '2026-08-26',
    now,
  }).trains;
}
function constraints(overrides = {}) {
  return personalConstraintsSchema.parse({
    stationReadyAt: '2026-08-26T11:53:00+09:00',
    ...overrides,
  });
}

describe('Personal Shinkansen options', () => {
  it('quantifies the cost versus actual destination-arrival tradeoff', async () => {
    const trains = await candidates();
    const result = evaluateTrainOptions(trains, constraints(), now);
    expect(result.picks).toEqual({
      cheapest: trains[1]!.id,
      fastest: trains[0]!.id,
      earliestArrival: trains[0]!.id,
    });
    expect(result.cheapestTradeoff).toMatchObject({ savingsJPY: 320, extraMinutes: 57 });
    expect(result.feasible[0]?.latestStationArrival).toBe('2026-08-26T11:53:00+09:00');
    expect(result.feasible[0]?.source).toEqual(trains[0]!.source);
  });

  it('checks boarding and exit allowances against the full timestamps', async () => {
    const result = evaluateTrainOptions(
      await candidates(),
      constraints({
        stationReadyAt: '2026-08-26T02:54:00Z',
        exitBufferMinutes: 10,
        arriveBy: '2026-08-26T15:30:00+09:00',
      }),
      now,
    );
    expect(result.feasible).toHaveLength(0);
    expect(result.excluded.map((item) => item.reasons)).toEqual([
      ['boarding_buffer'],
      ['arrival_deadline'],
    ]);
  });

  it('does not substitute an unqualified fare for a requested seat class', async () => {
    const trains = await candidates();
    trains[0]!.fares = [
      { kind: 'total', amount: 100, currency: 'JPY' },
      { kind: 'total', amount: 20000, currency: 'JPY', seatClassId: 'green' },
    ];
    const result = evaluateTrainOptions(
      trains,
      constraints({ seatClassId: 'green', maxFareJPY: 19000 }),
      now,
    );
    expect(result.feasible).toHaveLength(0);
    expect(result.excluded[0]?.reasons).toEqual(['budget']);
    expect(result.excluded[1]?.reasons).toContain('seat_class_fare_unknown');
  });

  it('keeps unknown prices explicit and excludes them from cheapest or budget-constrained picks', async () => {
    const trains = await candidates();
    for (const train of trains) train.fares = [];
    const result = evaluateTrainOptions(trains, constraints(), now);
    expect(result.feasible).toHaveLength(2);
    expect(result.picks.cheapest).toBeNull();
    expect(result.feasible[0]?.fareJPY).toBeNull();
    expect(
      evaluateTrainOptions(trains, constraints({ maxFareJPY: 15000 }), now).feasible,
    ).toHaveLength(0);
  });

  it('rejects mixed routes and a deadline before readiness', async () => {
    const trains = await candidates();
    expect(() =>
      evaluateTrainOptions(trains, constraints({ arriveBy: '2026-08-26T10:00:00+09:00' }), now),
    ).toThrow('arriveBy');
    trains[1]!.destination.id = 'another-station';
    expect(() => evaluateTrainOptions(trains, constraints(), now)).toThrow('same station pair');
  });

  it('can be called through MCP repeatedly with exactly one initial provider fetch', async () => {
    let clock = now;
    const fetch = vi.fn(async () => Response.json(fixture));
    const provider = new EkispertProvider(stations, {
      apiKey: 'test-key',
      now: () => clock,
      fetch,
    });
    const service = new RailService(stations, provider, () => clock);
    const server = createServer(service);
    const client = new Client({ name: 'personal-options-test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      const search = await client.callTool({
        name: 'search_trains',
        arguments: {
          fromStationId: 'jp:station:tokyo',
          toStationId: 'jp:station:shin-osaka',
          date: '2026-08-26',
        },
      });
      expect(search.isError).not.toBe(true);
      const trains = (search.structuredContent as { trains: { id: string }[] }).trains;
      for (const budget of [15000, 14500]) {
        const result = await client.callTool({
          name: 'evaluate_train_options',
          arguments: {
            trainIds: trains.map((train) => train.id),
            stationReadyAt: '2026-08-26T11:53:00+09:00',
            maxFareJPY: budget,
          },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          dataMode: 'saved_search_snapshot',
          considered: 2,
        });
        expect((result.structuredContent as { feasible: unknown[] }).feasible.length).toBe(
          budget === 15000 ? 2 : 1,
        );
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      clock = new Date(now.getTime() + 15 * 60_000);
      const expired = await client.callTool({
        name: 'evaluate_train_options',
        arguments: { trainIds: [trains[0]!.id], stationReadyAt: '2026-08-26T11:53:00+09:00' },
      });
      expect(expired.isError).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
