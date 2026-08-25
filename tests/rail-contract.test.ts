import { describe, expect, it } from 'vitest';
import {
  sourceSchema,
  stationSchema,
  trainSchema,
  type Station,
  type Train,
} from '../src/core/schemas.js';

function describeRailContract(name: string, fixtures: { station: Station; train: Train }): void {
  describe(`${name} shared rail contract`, () => {
    it('uses a stable station ID and country code', () => {
      expect(stationSchema.parse(fixtures.station)).toMatchObject({ countryCode: 'JP' });
      expect(fixtures.station.id).not.toBe(fixtures.station.localName);
    });

    it('uses numeric ISO-4217 fares and explicit timezone offsets', () => {
      expect(trainSchema.parse(fixtures.train)).toBeDefined();
      expect(fixtures.train.fares.every((fare) => Number.isFinite(fare.amount))).toBe(true);
      expect(fixtures.train.fares.every((fare) => fare.currency === 'JPY')).toBe(true);
      expect(fixtures.train.departureTime).toMatch(/\+09:00$/);
      expect(fixtures.train.arrivalTime).toMatch(/\+09:00$/);
    });

    it('requires provenance', () => {
      expect(sourceSchema.parse(fixtures.station.source)).toBeDefined();
      expect(sourceSchema.parse(fixtures.train.source)).toBeDefined();
    });
  });
}

const source = {
  provider: 'contract-fixture',
  retrievedAt: '2026-08-25T00:00:00Z',
  isRealtime: false,
};
const station: Station = {
  id: 'jp:station:tokyo',
  name: '東京',
  localName: '東京',
  englishName: 'Tokyo',
  aliases: ['Tokyo Station'],
  countryCode: 'JP',
  operators: ['JR East', 'JR Central'],
  prefecture: 'Tokyo',
  extensions: { japan: { shinkansenLines: ['Tokaido Shinkansen'], providerNames: {} } },
  source,
};
const train: Train = {
  id: 'fixture:nozomi-215',
  trainNumber: 'のぞみ215号',
  trainName: 'のぞみ215号',
  origin: {
    id: station.id,
    name: station.name,
    localName: station.localName,
    englishName: 'Tokyo',
  },
  destination: {
    id: 'jp:station:shin-osaka',
    name: '新大阪',
    localName: '新大阪',
    englishName: 'Shin-Osaka',
  },
  departureTime: '2026-08-26T12:03:00+09:00',
  arrivalTime: '2026-08-26T14:30:00+09:00',
  durationMinutes: 147,
  operator: 'JR Central',
  serviceType: 'shinkansen',
  transferCount: 0,
  fares: [{ amount: 14720, currency: 'JPY', formatted: '¥14,720', kind: 'total' }],
  seatClasses: [{ id: 'reserved', name: 'Reserved', localName: '指定席' }],
  source,
  extensions: {
    japan: {
      shinkansenLine: '東海道新幹線',
      serviceName: 'のぞみ',
      passengerFacingNumber: 'のぞみ215号',
    },
  },
};

describeRailContract('Japan', { station, train });
