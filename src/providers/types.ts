import type {
  Journey,
  RailProviderCapabilities,
  SeatAvailability,
  Station,
  Train,
  TrainDetails,
} from '../core/schemas.js';

export interface SearchStationsInput {
  query: string;
  limit?: number | undefined;
}

export interface SearchTrainsInput {
  fromStationId: string;
  toStationId: string;
  date: string;
  departureAfter?: string | undefined;
  departureBefore?: string | undefined;
  limit?: number | undefined;
  serviceTypes?: string[] | undefined;
  operators?: string[] | undefined;
}

export interface SearchJourneysInput extends SearchTrainsInput {
  includeNonShinkansen?: boolean | undefined;
}

export interface TrainDetailsInput {
  trainId: string;
}

export interface AvailabilityInput {
  trainId: string;
  fromStationId: string;
  toStationId: string;
  date: string;
}

export interface ProviderStatus {
  provider: string;
  capabilities: RailProviderCapabilities;
  configured: boolean;
  notes: string[];
}

export interface StationCatalogProvider {
  searchStations(input: SearchStationsInput): Promise<Station[]>;
  getStation(stationId: string): Promise<Station>;
}

export interface RailDataProvider {
  readonly capabilities: RailProviderCapabilities;
  getStatus(): ProviderStatus;
  searchTrains(input: SearchTrainsInput): Promise<Train[]>;
  searchJourneys(input: SearchJourneysInput): Promise<Journey[]>;
  getTrainDetails(input: TrainDetailsInput): Promise<TrainDetails>;
  getAvailability(input: AvailabilityInput): Promise<SeatAvailability>;
}
