import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { trainDetailsSchema, trainSchema } from '../src/core/schemas.js';
import { EkispertProvider, parseEkispertCourses } from '../src/providers/ekispert.js';
import { StaticShinkansenStationProvider } from '../src/providers/static/station-provider.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/ekispert-shinkansen-course.json', import.meta.url), 'utf8'),
) as unknown;
const now = () => new Date('2026-08-25T04:00:00Z');

describe('Ekispert Shinkansen provider', () => {
  const stations = new StaticShinkansenStationProvider();

  it.each([
    ['jp:station:tokyo', 'jp:station:shin-osaka', '東海道新幹線のぞみ215号', '215'],
    ['jp:station:shin-osaka', 'jp:station:hakata', '山陽新幹線のぞみ15号', '15'],
    ['jp:station:tokyo', 'jp:station:sendai', '東北新幹線はやぶさ31号', '31'],
  ])(
    'searches the priority route %s → %s',
    async (fromStationId, toStationId, lineName, trainNumber) => {
      const routeFixture = {
        ResultSet: {
          Course: {
            Price: [
              { kind: 'FareSummary', Oneway: '10000' },
              { kind: 'ChargeSummary', Oneway: '5000' },
            ],
            Route: {
              transferCount: '0',
              timeOnBoard: '120',
              Line: {
                Name: lineName,
                Number: trainNumber,
                Type: { text: 'train', detail: 'shinkansen' },
                DepartureState: { Datetime: '2026-08-26T10:00:00+09:00' },
                ArrivalState: { Datetime: '2026-08-26T12:00:00+09:00' },
              },
            },
          },
        },
      };
      const provider = new EkispertProvider(stations, {
        apiKey: 'test-key',
        now,
        fetch: async () => Response.json(routeFixture),
      });
      const results = await provider.searchTrains({
        fromStationId,
        toStationId,
        date: '2026-08-26',
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        origin: { id: fromStationId },
        destination: { id: toStationId },
        transferCount: 0,
        serviceType: 'shinkansen',
      });
    },
  );

  it('parses only direct Shinkansen services with JPY fares and explicit timestamps', async () => {
    const from = await stations.getStation('jp:station:tokyo');
    const to = await stations.getStation('jp:station:shin-osaka');
    const result = parseEkispertCourses(fixture, { from, to, date: '2026-08-26', now: now() });
    expect(result.trains).toHaveLength(2);
    expect(result.trains[0]).toMatchObject({
      trainNumber: 'のぞみ215号',
      departureTime: '2026-08-26T12:03:00+09:00',
      arrivalTime: '2026-08-26T14:30:00+09:00',
      durationMinutes: 147,
      serviceType: 'shinkansen',
      transferCount: 0,
    });
    expect(result.trains[0]?.fares).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 14720, currency: 'JPY', kind: 'total' }),
      ]),
    );
    expect(result.trains[0]?.seatClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'reserved', localName: '指定席' }),
        expect.objectContaining({ id: 'green', localName: 'グリーン車' }),
      ]),
    );
    expect(() => trainSchema.parse(result.trains[0])).not.toThrow();
    expect(result.details[0]?.stops.map((stop) => stop.station.localName)).toEqual([
      '東京',
      '名古屋',
      '京都',
      '新大阪',
    ]);
    expect(() => trainDetailsSchema.parse(result.details[0])).not.toThrow();
  });

  it('sends an explicit midnight rather than inferring the current time', async () => {
    let requestedUrl: URL | undefined;
    const provider = new EkispertProvider(stations, {
      apiKey: 'test-key',
      now,
      fetch: async (input) => {
        requestedUrl = new URL(input instanceof Request ? input.url : input);
        return Response.json(fixture);
      },
    });
    const trains = await provider.searchTrains({
      fromStationId: 'jp:station:tokyo',
      toStationId: 'jp:station:shin-osaka',
      date: '2026-08-26',
    });
    expect(trains).toHaveLength(2);
    expect(requestedUrl?.searchParams.get('time')).toBe('0000');
    expect(requestedUrl?.searchParams.get('date')).toBe('20260826');
    expect(requestedUrl?.searchParams.get('viaList')).toBe('東京:新大阪');
    expect(requestedUrl?.searchParams.get('addStop')).toBe('true');
  });

  it('replays the encoded search reference for train details without exposing fixture data as live', async () => {
    const provider = new EkispertProvider(stations, {
      apiKey: 'test-key',
      now,
      fetch: async () => Response.json(fixture),
    });
    const trains = await provider.searchTrains({
      fromStationId: 'jp:station:tokyo',
      toStationId: 'jp:station:shin-osaka',
      date: '2026-08-26',
    });
    const train = trains[0];
    expect(train).toBeDefined();
    const details = await provider.getTrainDetails({ trainId: train!.id });
    expect(details.train.id).toBe(train!.id);
    expect(details.stops[0]?.station.id).toBe('jp:station:tokyo');
  });

  it('reports train search as unsupported when no deployment key exists', async () => {
    const provider = new EkispertProvider(stations, { now });
    expect(provider.getStatus()).toMatchObject({
      configured: false,
      capabilities: { stationSearch: true, timetable: false, availability: false },
    });
    await expect(
      provider.searchTrains({
        fromStationId: 'jp:station:tokyo',
        toStationId: 'jp:station:shin-osaka',
        date: '2026-08-26',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FEATURE' });
  });

  it('returns explicit unsupported availability without a fake count', async () => {
    const provider = new EkispertProvider(stations, { now });
    await expect(
      provider.getAvailability({
        trainId: 'opaque',
        fromStationId: 'jp:station:tokyo',
        toStationId: 'jp:station:shin-osaka',
        date: '2026-08-26',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'unsupported', retrievedAt: now().toISOString() }),
    );
  });

  it('maps rate limits without leaking the access key', async () => {
    const provider = new EkispertProvider(stations, {
      apiKey: 'secret-test-key',
      now,
      fetch: async () => new Response(null, { status: 429 }),
    });
    await expect(
      provider.searchTrains({
        fromStationId: 'jp:station:tokyo',
        toStationId: 'jp:station:sendai',
        date: '2026-08-26',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await provider
      .searchTrains({
        fromStationId: 'jp:station:tokyo',
        toStationId: 'jp:station:sendai',
        date: '2026-08-26',
      })
      .catch((error: unknown) => {
        expect(String(error)).not.toContain('secret-test-key');
      });
  });
});
