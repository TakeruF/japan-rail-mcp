import { RailError } from '../core/errors.js';
import { timePart } from '../core/date.js';
import { evaluateTrainOptions, tokyoTimestamp } from './train-options.js';
import {
  preferencesSchema,
  resolvePersonalConstraints,
  type PersonalInput,
  type PersonalPreferences,
} from '../core/preferences.js';
import type { Train } from '../core/schemas.js';
import type {
  AvailabilityInput,
  RailDataProvider,
  SearchJourneysInput,
  SearchStationsInput,
  SearchTrainsInput,
  StationCatalogProvider,
  TrainDetailsInput,
} from '../providers/types.js';

export interface Pagination {
  limit: number;
  offset: number;
}

export interface TrainPage extends Pagination {
  total: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
  trains: Train[];
}

export class RailService {
  readonly #savedTrains = new Map<string, { train: Train; savedAt: number }>();

  constructor(
    private readonly stations: StationCatalogProvider,
    private readonly rail: RailDataProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly preferences: PersonalPreferences = preferencesSchema.parse({}),
  ) {}

  getPersonalPreferences() {
    return structuredClone(this.preferences);
  }

  async planShinkansenTrip(input: PersonalInput & { fromStationId: string; toStationId: string }) {
    const { fromStationId, toStationId, ...personal } = input;
    const constraints = resolvePersonalConstraints(
      personal,
      this.preferences,
      fromStationId,
      toStationId,
    );
    const earliestDeparture = tokyoTimestamp(
      Date.parse(constraints.stationReadyAt) + constraints.boardingBufferMinutes * 60_000,
    );
    if (
      constraints.arriveBy !== undefined &&
      Date.parse(constraints.arriveBy) < Date.parse(earliestDeparture)
    ) {
      throw new RailError(
        'INVALID_TIME',
        'Arrival deadline is before the earliest allowed departure.',
      );
    }
    const trains = await this.rail.searchTrains({
      fromStationId,
      toStationId,
      date: earliestDeparture.slice(0, 10),
      departureAfter: earliestDeparture.slice(11, 16),
      limit: 20,
    });
    this.#saveTrains(trains);
    return evaluateTrainOptions(trains, constraints, this.now(), 'provider_search');
  }

  getStationDetails(stationId: string) {
    return this.stations.getStation(stationId);
  }

  evaluateSavedTrains(trainIds: string[], input: PersonalInput) {
    const now = this.now();
    const trains = [...new Set(trainIds)].map((id) => {
      const saved = this.#savedTrains.get(id);
      if (!saved || now.getTime() - saved.savedAt >= 15 * 60_000) {
        this.#savedTrains.delete(id);
        throw new RailError(
          'TRAIN_NOT_FOUND',
          'Train snapshot is missing or expired. Use IDs from a search in this server session within the last 15 minutes.',
        );
      }
      return saved.train;
    });
    const first = trains[0];
    if (!first) throw new RailError('TRAIN_NOT_FOUND', 'At least one saved train ID is required.');
    const constraints = resolvePersonalConstraints(
      input,
      this.preferences,
      first.origin.id,
      first.destination.id,
    );
    return evaluateTrainOptions(trains, constraints, now);
  }

  #saveTrains(trains: Train[]) {
    const savedAt = this.now().getTime();
    for (const [id, saved] of this.#savedTrains) {
      if (savedAt - saved.savedAt >= 15 * 60_000) this.#savedTrains.delete(id);
    }
    for (const train of trains) {
      this.#savedTrains.delete(train.id);
      this.#savedTrains.set(train.id, { train: structuredClone(train), savedAt });
    }
    while (this.#savedTrains.size > 200) {
      this.#savedTrains.delete(this.#savedTrains.keys().next().value!);
    }
  }

  getProviderStatus() {
    return this.rail.getStatus();
  }

  async searchStations(input: SearchStationsInput) {
    return { stations: await this.stations.searchStations(input) };
  }

  async searchTrains(input: SearchTrainsInput, pagination: Pagination): Promise<TrainPage> {
    const trains = await this.rail.searchTrains({ ...input, limit: 20 });
    this.#saveTrains(trains);
    return paginate(trains, pagination);
  }

  async compareTrains(
    input: SearchTrainsInput,
    pagination: Pagination,
    sortBy: 'departure_time' | 'arrival_time' | 'duration' | 'price',
  ): Promise<TrainPage> {
    const trains = await this.rail.searchTrains({ ...input, limit: 20 });
    this.#saveTrains(trains);
    trains.sort((left, right) => compare(left, right, sortBy));
    return paginate(trains, pagination);
  }

  async searchJourneys(input: SearchJourneysInput) {
    return { journeys: await this.rail.searchJourneys(input) };
  }

  getTrainDetails(input: TrainDetailsInput) {
    return this.rail.getTrainDetails(input);
  }

  getAvailability(input: AvailabilityInput) {
    return this.rail.getAvailability(input);
  }
}

function paginate(trains: Train[], pagination: Pagination): TrainPage {
  const page = trains.slice(pagination.offset, pagination.offset + pagination.limit);
  const nextOffset = pagination.offset + page.length;
  return {
    total: trains.length,
    limit: pagination.limit,
    offset: pagination.offset,
    returned: page.length,
    hasMore: nextOffset < trains.length,
    nextOffset: nextOffset < trains.length ? nextOffset : null,
    trains: page,
  };
}

function compare(
  left: Train,
  right: Train,
  sortBy: 'departure_time' | 'arrival_time' | 'duration' | 'price',
): number {
  if (sortBy === 'duration') return left.durationMinutes - right.durationMinutes;
  if (sortBy === 'arrival_time') return left.arrivalTime.localeCompare(right.arrivalTime);
  if (sortBy === 'price') return minimumTotal(left) - minimumTotal(right);
  return timePart(left.departureTime).localeCompare(timePart(right.departureTime));
}

function minimumTotal(train: Train): number {
  const totals = train.fares.filter((fare) => fare.kind === 'total').map((fare) => fare.amount);
  if (totals.length === 0) return Number.POSITIVE_INFINITY;
  const minimum = Math.min(...totals);
  if (!Number.isFinite(minimum)) {
    throw new RailError('PROVIDER_RESPONSE_CHANGED', 'Provider returned a non-finite fare.');
  }
  return minimum;
}
