import { describe, expect, it } from 'vitest';
import { StaticShinkansenStationProvider } from '../src/providers/static/station-provider.js';

describe('Shinkansen station catalog', () => {
  const provider = new StaticShinkansenStationProvider();

  it.each([
    ['東京', 'jp:station:tokyo'],
    ['Tokyo', 'jp:station:tokyo'],
    ['新大阪', 'jp:station:shin-osaka'],
    ['Shin-Osaka', 'jp:station:shin-osaka'],
  ])('finds %s without guessing a provider station code', async (query, expectedId) => {
    await expect(provider.searchStations({ query })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expectedId, countryCode: 'JP' })]),
    );
  });

  it('returns multiple candidates for Osaka instead of silently selecting Shin-Osaka', async () => {
    const results = await provider.searchStations({ query: '大阪' });
    expect(results.map((station) => station.id)).toEqual(
      expect.arrayContaining(['jp:station:osaka', 'jp:station:shin-osaka']),
    );
  });

  it('preserves Fukuoka city/station ambiguity', async () => {
    const results = await provider.searchStations({ query: 'Fukuoka' });
    expect(results.map((station) => station.id)).toEqual(
      expect.arrayContaining(['jp:station:hakata', 'jp:station:fukuoka-toyama']),
    );
  });

  it('returns distinct Shinjuku-area stations', async () => {
    const results = await provider.searchStations({ query: '新宿' });
    expect(results.map((station) => station.id)).toEqual(
      expect.arrayContaining([
        'jp:station:shinjuku',
        'jp:station:shinjuku-sanchome',
        'jp:station:seibu-shinjuku',
      ]),
    );
  });

  it('requires a canonical station ID for exact lookup', async () => {
    await expect(provider.getStation('東京')).rejects.toMatchObject({ code: 'STATION_NOT_FOUND' });
  });
});
