import { RailError } from '../core/errors.js';
import { timePart } from '../core/date.js';
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
  constructor(
    private readonly stations: StationCatalogProvider,
    private readonly rail: RailDataProvider,
  ) {}

  getProviderStatus() {
    return this.rail.getStatus();
  }

  async searchStations(input: SearchStationsInput) {
    return { stations: await this.stations.searchStations(input) };
  }

  async searchTrains(input: SearchTrainsInput, pagination: Pagination): Promise<TrainPage> {
    const trains = await this.rail.searchTrains({ ...input, limit: 20 });
    return paginate(trains, pagination);
  }

  async compareTrains(
    input: SearchTrainsInput,
    pagination: Pagination,
    sortBy: 'departure_time' | 'arrival_time' | 'duration' | 'price',
  ): Promise<TrainPage> {
    const trains = await this.rail.searchTrains({ ...input, limit: 20 });
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
