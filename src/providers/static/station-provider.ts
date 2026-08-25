import { RailError } from '../../core/errors.js';
import type { Station } from '../../core/schemas.js';
import type { SearchStationsInput, StationCatalogProvider } from '../types.js';
import { SHINKANSEN_STATIONS } from './shinkansen-stations.js';

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\-‐‑‒–—―・()（）]/g, '');
}

function score(station: Station, query: string): number | null {
  const values = [station.localName, station.englishName, ...station.aliases]
    .filter((value): value is string => value !== undefined)
    .map(normalize);
  if (values.includes(query)) return 0;
  if (values.some((value) => value.startsWith(query))) return 1;
  if (values.some((value) => value.includes(query))) return 2;
  return null;
}

export class StaticShinkansenStationProvider implements StationCatalogProvider {
  readonly #stations: Station[];

  constructor(stations: Station[] = SHINKANSEN_STATIONS) {
    this.#stations = stations;
  }

  async searchStations(input: SearchStationsInput): Promise<Station[]> {
    const query = normalize(input.query.trim());
    if (!query) return [];
    const limit = input.limit ?? 20;
    return this.#stations
      .map((station) => ({ station, score: score(station, query) }))
      .filter((item): item is { station: Station; score: number } => item.score !== null)
      .sort(
        (left, right) =>
          left.score - right.score || left.station.id.localeCompare(right.station.id),
      )
      .slice(0, limit)
      .map(({ station }) => station);
  }

  async getStation(stationId: string): Promise<Station> {
    const station = this.#stations.find((candidate) => candidate.id === stationId);
    if (!station) {
      throw new RailError(
        'STATION_NOT_FOUND',
        `Unknown station ID: ${stationId}. Use search_stations before searching trains.`,
      );
    }
    return station;
  }
}
