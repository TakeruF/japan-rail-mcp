import { RailError } from '../core/errors.js';
import { assertNotPastDate, assertTime, minutesBetween, timePart } from '../core/date.js';
import {
  toStationRef,
  type Fare,
  type SeatClass,
  type Source,
  type Station,
  type Train,
  type TrainDetails,
  type TrainStop,
} from '../core/schemas.js';
import type {
  AvailabilityInput,
  ProviderStatus,
  RailDataProvider,
  SearchJourneysInput,
  SearchTrainsInput,
  StationCatalogProvider,
  TrainDetailsInput,
} from './types.js';

type JsonRecord = Record<string, unknown>;
type Fetch = typeof fetch;

interface EkispertOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: Fetch;
  now?: () => Date;
}

interface TrainReference {
  version: 1;
  date: string;
  fromStationId: string;
  toStationId: string;
  trainNumber: string;
  departureTime: string;
}

interface ParsedCourses {
  trains: Train[];
  details: TrainDetails[];
}

const SHINKANSEN_PATTERN =
  /新幹線|のぞみ|ひかり|こだま|みずほ|さくら|つばめ|はやぶさ|はやて|やまびこ|なすの|こまち|つばさ|とき|たにがわ|かがやき|はくたか|あさま|つるぎ|かもめ/i;

export class EkispertProvider implements RailDataProvider {
  readonly capabilities;
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #fetch: Fetch;
  readonly #catalog: StationCatalogProvider;
  readonly #now: () => Date;
  readonly #details = new Map<string, TrainDetails>();

  constructor(catalog: StationCatalogProvider, options: EkispertOptions = {}) {
    this.#catalog = catalog;
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl ?? 'https://api.ekispert.jp/v1';
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    const configured = Boolean(this.#apiKey);
    this.capabilities = {
      stationSearch: true,
      timetable: configured,
      trainStops: configured,
      fares: configured,
      availability: false,
      journeySearch: false,
    };
  }

  getStatus(): ProviderStatus {
    const configured = Boolean(this.#apiKey);
    return {
      provider: configured ? 'ekispert-standard' : 'static-shinkansen-stations',
      capabilities: this.capabilities,
      configured,
      notes: configured
        ? [
            'Live Shinkansen timetable, fare, seat-class, and stop data use the deployment owner’s Ekispert API agreement.',
            'Seat inventory is not provided.',
            'search_trains returns direct Shinkansen services only.',
          ]
        : [
            'Set EKISPERT_API_KEY from an Ekispert API Standard Plan to enable live train data.',
            'The bundled station catalog remains available without credentials.',
            'No fixture timetable is exposed as live data.',
          ],
    };
  }

  async searchTrains(input: SearchTrainsInput): Promise<Train[]> {
    this.#requireApiKey('timetable');
    assertNotPastDate(input.date, this.#now());
    if (input.departureAfter !== undefined) assertTime(input.departureAfter);
    if (input.departureBefore !== undefined) assertTime(input.departureBefore);
    if (
      input.departureAfter !== undefined &&
      input.departureBefore !== undefined &&
      input.departureAfter > input.departureBefore
    ) {
      throw new RailError('INVALID_TIME', 'departureAfter must not be later than departureBefore.');
    }
    const [from, to] = await Promise.all([
      this.#catalog.getStation(input.fromStationId),
      this.#catalog.getStation(input.toStationId),
    ]);
    if (from.id === to.id) {
      throw new RailError('JOURNEY_NOT_FOUND', 'Origin and destination stations must differ.');
    }
    const payload = await this.#search(from, to, input);
    const parsed = parseEkispertCourses(payload, { from, to, date: input.date, now: this.#now() });
    for (const details of parsed.details) this.#details.set(details.train.id, details);
    return filterTrains(parsed.trains, input);
  }

  async searchJourneys(_input: SearchJourneysInput): Promise<never> {
    throw new RailError(
      'UNSUPPORTED_FEATURE',
      'Journey parsing is not enabled in the Shinkansen-first MVP. Use search_trains for direct Shinkansen services.',
    );
  }

  async getTrainDetails(input: TrainDetailsInput): Promise<TrainDetails> {
    const cached = this.#details.get(input.trainId);
    if (cached) return cached;
    const reference = decodeTrainReference(input.trainId);
    await this.searchTrains({
      fromStationId: reference.fromStationId,
      toStationId: reference.toStationId,
      date: reference.date,
      departureAfter: timePart(reference.departureTime),
      limit: 20,
    });
    const details = this.#details.get(input.trainId);
    if (!details) {
      throw new RailError(
        'TRAIN_NOT_FOUND',
        `The provider no longer returned train ${input.trainId}.`,
      );
    }
    return details;
  }

  async getAvailability(_input: AvailabilityInput) {
    return {
      status: 'unsupported' as const,
      reason:
        'The configured provider does not expose reservation inventory. Verify seats through an official booking channel.',
      retrievedAt: this.#now().toISOString(),
    };
  }

  #requireApiKey(feature: string): string {
    if (!this.#apiKey) {
      throw new RailError(
        'UNSUPPORTED_FEATURE',
        `${feature} requires a user-supplied EKISPERT_API_KEY for the Ekispert API Standard Plan.`,
      );
    }
    return this.#apiKey;
  }

  async #search(from: Station, to: Station, input: SearchTrainsInput): Promise<unknown> {
    const apiKey = this.#requireApiKey('timetable');
    const url = new URL(`${this.#baseUrl.replace(/\/$/, '')}/json/search/course/extreme`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set(
      'viaList',
      `${from.extensions.japan.providerNames.ekispert}:${to.extensions.japan.providerNames.ekispert}`,
    );
    url.searchParams.set('date', input.date.replaceAll('-', ''));
    url.searchParams.set('time', (input.departureAfter ?? '00:00').replace(':', ''));
    url.searchParams.set('searchType', 'departure');
    url.searchParams.set('answerCount', String(Math.min(input.limit ?? 20, 20)));
    url.searchParams.set('searchCount', '20');
    url.searchParams.set('sort', 'ekispert');
    url.searchParams.set('addStop', 'true');
    url.searchParams.set('addSeatType', 'true');
    url.searchParams.set('resultDetail', 'addCorporation');

    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new RailError('NETWORK_TIMEOUT', 'Ekispert did not respond within 10 seconds.', {
          cause: error,
        });
      }
      throw new RailError('PROVIDER_UNAVAILABLE', 'Ekispert could not be reached.', {
        cause: error,
      });
    }
    if (response.status === 429) {
      throw new RailError(
        'RATE_LIMITED',
        'Ekispert rate-limited the request. Do not poll automatically.',
      );
    }
    if (!response.ok) {
      throw new RailError(
        'PROVIDER_UNAVAILABLE',
        `Ekispert returned HTTP ${response.status}. Check the key, plan, and provider status.`,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new RailError('PROVIDER_RESPONSE_CHANGED', 'Ekispert returned invalid JSON.', {
        cause: error,
      });
    }
  }
}

function filterTrains(trains: Train[], input: SearchTrainsInput): Train[] {
  return trains
    .filter(
      (train) =>
        (input.departureAfter === undefined ||
          timePart(train.departureTime) >= input.departureAfter) &&
        (input.departureBefore === undefined ||
          timePart(train.departureTime) <= input.departureBefore) &&
        (input.serviceTypes === undefined ||
          input.serviceTypes.some(
            (type) =>
              type.toLocaleLowerCase('en-US') === train.serviceType ||
              type.toLocaleLowerCase('en-US') ===
                train.extensions.japan.serviceName?.toLocaleLowerCase('en-US'),
          )) &&
        (input.operators === undefined ||
          (train.operator !== undefined && input.operators.includes(train.operator))),
    )
    .slice(0, input.limit ?? 20);
}

export function parseEkispertCourses(
  payload: unknown,
  context: { from: Station; to: Station; date: string; now?: Date },
): ParsedCourses {
  const root = record(payload, 'response');
  const resultSet = record(root.ResultSet, 'ResultSet');
  if (resultSet.Error !== undefined) {
    const providerError = record(resultSet.Error, 'ResultSet.Error');
    throw new RailError(
      'PROVIDER_UNAVAILABLE',
      `Ekispert rejected the request: ${text(providerError.Message) ?? 'unknown provider error'}.`,
    );
  }
  const courses = array(resultSet.Course);
  const retrievedAt = (context.now ?? new Date()).toISOString();
  const trains: Train[] = [];
  const details: TrainDetails[] = [];
  for (const rawCourse of courses) {
    const course = record(rawCourse, 'Course');
    const route = record(course.Route, 'Course.Route');
    if (number(route.transferCount) !== 0) continue;
    const lines = array(route.Line).map((value) => record(value, 'Course.Route.Line'));
    const railLines = lines.filter((line) => text(line.Type) === 'train');
    if (railLines.length !== 1) continue;
    const line = railLines[0];
    if (!line) continue;
    const lineName = text(line.Name) ?? '';
    const detail = text(recordOrEmpty(line.Type).detail) ?? '';
    if (!SHINKANSEN_PATTERN.test(`${lineName} ${detail}`)) continue;
    const departureTime = timestamp(line.DepartureState, context.date);
    const arrivalTime = timestamp(line.ArrivalState, context.date);
    if (!departureTime || !arrivalTime) continue;
    const serviceName = extractServiceName(lineName);
    const providerNumber = text(line.Number) ?? extractNumber(lineName) ?? lineName;
    const passengerFacingNumber = serviceName
      ? `${serviceName}${providerNumber.replace(/号$/, '')}号`
      : providerNumber;
    const reference: TrainReference = {
      version: 1,
      date: context.date,
      fromStationId: context.from.id,
      toStationId: context.to.id,
      trainNumber: passengerFacingNumber,
      departureTime,
    };
    const id = encodeTrainReference(reference);
    const source: Source = {
      provider: 'ekispert-standard',
      dataset: 'search/course/extreme',
      retrievedAt,
      isRealtime: false,
      license: 'Subject to the deployment owner’s Ekispert API agreement',
    };
    const prices = parsePrices(course.Price);
    const operator = text(recordOrEmpty(line.Corporation).Name);
    const shinkansenLine = extractShinkansenLine(lineName);
    const train: Train = {
      id,
      trainNumber: passengerFacingNumber,
      trainName: lineName || passengerFacingNumber,
      origin: toStationRef(context.from),
      destination: toStationRef(context.to),
      departureTime,
      arrivalTime,
      durationMinutes: number(line.timeOnBoard) ?? minutesBetween(departureTime, arrivalTime),
      ...(operator === undefined ? {} : { operator }),
      serviceType: 'shinkansen',
      transferCount: 0,
      fares: prices.fares,
      seatClasses: prices.seatClasses,
      source,
      extensions: {
        japan: {
          ...(shinkansenLine === undefined ? {} : { shinkansenLine }),
          ...(serviceName === undefined ? {} : { serviceName }),
          passengerFacingNumber,
          providerTrainId: providerNumber,
        },
      },
    };
    const stops = parseStops(line.Stop, train, context);
    trains.push(train);
    details.push({ train, stops, source });
  }
  return { trains, details };
}

function parsePrices(value: unknown): { fares: Fare[]; seatClasses: SeatClass[] } {
  const prices = array(value).map((item) => record(item, 'Course.Price'));
  const base = prices.find((price) => text(price.kind) === 'FareSummary');
  const chargeSummary = prices.find((price) => text(price.kind) === 'ChargeSummary');
  const fares: Fare[] = [];
  const baseAmount = number(base?.Oneway);
  const chargeAmount = number(chargeSummary?.Oneway);
  if (baseAmount !== undefined) fares.push(fare(baseAmount, 'base'));
  if (chargeAmount !== undefined) fares.push(fare(chargeAmount, 'limited_express'));
  if (baseAmount !== undefined || chargeAmount !== undefined) {
    fares.push(fare((baseAmount ?? 0) + (chargeAmount ?? 0), 'total'));
  }
  const seatClasses = new Map<string, SeatClass>();
  for (const price of prices.filter((item) => text(item.kind) === 'Charge')) {
    const providerType = text(price.Type) ?? text(recordOrEmpty(price.SeatType).Type);
    if (!providerType) continue;
    const seat = normalizeSeatClass(providerType, text(price.Name));
    seatClasses.set(seat.id, seat);
    const amount = number(price.Oneway);
    if (amount !== undefined) {
      fares.push({ ...fare(amount, 'limited_express'), seatClassId: seat.id });
    }
  }
  return { fares, seatClasses: [...seatClasses.values()] };
}

function fare(amount: number, kind: Fare['kind']): Fare {
  return { amount, currency: 'JPY', formatted: `¥${amount.toLocaleString('ja-JP')}`, kind };
}

function normalizeSeatClass(providerType: string, providerLabel?: string): SeatClass {
  const mapping: Record<string, [string, string, string]> = {
    Free: ['unreserved', 'Non-reserved', '自由席'],
    FreeInCar: ['unreserved', 'Non-reserved', '自由席'],
    Reserved: ['reserved', 'Reserved', '指定席'],
    SWorkPSeat: ['reserved_s_work_p', 'S Work P Seat', 'S Work Pシート'],
    Green: ['green', 'Green Car', 'グリーン車'],
    GreenInCar: ['green', 'Green Car', 'グリーン車'],
    GranClass: ['granclass', 'GranClass', 'グランクラス'],
    PremiumGreen: ['premium_green', 'Premium Green', 'プレミアムグリーン'],
    NoneReserved: ['seat_unspecified', 'Seat unspecified', '座席未指定席'],
  };
  const known = mapping[providerType];
  if (known) {
    return {
      id: known[0],
      name: known[1],
      localName: known[2],
      providerLabel: providerLabel ?? providerType,
    };
  }
  return {
    id: `provider:${providerType.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '_')}`,
    name: providerLabel ?? providerType,
    localName: providerLabel ?? providerType,
    providerLabel: providerLabel ?? providerType,
  };
}

function parseStops(
  value: unknown,
  train: Train,
  context: { from: Station; to: Station; date: string },
): TrainStop[] {
  const stops: TrainStop[] = [
    { sequence: 1, station: train.origin, arrivalTime: null, departureTime: train.departureTime },
  ];
  for (const raw of array(value)) {
    const stop = record(raw, 'Line.Stop');
    const point = record(stop.Point, 'Line.Stop.Point');
    const station = record(point.Station, 'Line.Stop.Point.Station');
    const localName = text(station.Name);
    if (
      !localName ||
      localName === train.origin.localName ||
      localName === train.destination.localName
    ) {
      continue;
    }
    const code = text(station.code) ?? localName;
    stops.push({
      sequence: stops.length + 1,
      station: {
        id: `jp:ekispert-station:${code}`,
        name: localName,
        localName,
      },
      arrivalTime: timestamp(stop.ArrivalState, context.date),
      departureTime: timestamp(stop.DepartureState, context.date),
    });
  }
  stops.push({
    sequence: stops.length + 1,
    station: train.destination,
    arrivalTime: train.arrivalTime,
    departureTime: null,
  });
  return stops;
}

function timestamp(state: unknown, date: string): string | null {
  const value = text(recordOrEmpty(state).Datetime);
  if (!value) return null;
  if (/^\d{2}:\d{2}:\d{2}\+09:00$/.test(value)) return `${date}T${value}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(value)) return value;
  throw new RailError(
    'PROVIDER_RESPONSE_CHANGED',
    `Ekispert returned an unexpected timestamp shape: ${value}.`,
  );
}

function encodeTrainReference(reference: TrainReference): string {
  return `ekispert:${Buffer.from(JSON.stringify(reference)).toString('base64url')}`;
}

function decodeTrainReference(id: string): TrainReference {
  if (!id.startsWith('ekispert:')) {
    throw new RailError('TRAIN_NOT_FOUND', 'Unknown train ID provider prefix.');
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(id.slice('ekispert:'.length), 'base64url').toString(),
    ) as JsonRecord;
    if (
      decoded.version !== 1 ||
      typeof decoded.date !== 'string' ||
      typeof decoded.fromStationId !== 'string' ||
      typeof decoded.toStationId !== 'string' ||
      typeof decoded.trainNumber !== 'string' ||
      typeof decoded.departureTime !== 'string'
    ) {
      throw new Error('invalid fields');
    }
    return decoded as unknown as TrainReference;
  } catch (error) {
    throw new RailError('TRAIN_NOT_FOUND', 'Malformed train ID.', { cause: error });
  }
}

function extractServiceName(name: string): string | undefined {
  return name.match(
    /(のぞみ|ひかり|こだま|みずほ|さくら|つばめ|はやぶさ|はやて|やまびこ|なすの|こまち|つばさ|とき|たにがわ|かがやき|はくたか|あさま|つるぎ|かもめ)/,
  )?.[1];
}

function extractNumber(name: string): string | undefined {
  return name.match(/(\d+)号/)?.[1];
}

function extractShinkansenLine(name: string): string | undefined {
  const lines = [
    '北海道',
    '東北',
    '秋田',
    '山形',
    '上越',
    '北陸',
    '東海道',
    '山陽',
    '九州',
    '西九州',
  ];
  const found = lines.find((line) => name.includes(`${line}新幹線`));
  return found ? `${found}新幹線` : undefined;
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RailError('PROVIDER_RESPONSE_CHANGED', `Expected an object at ${label}.`);
  }
  return value as JsonRecord;
}

function recordOrEmpty(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const item = recordOrEmpty(value);
  const nested = item.text ?? item['#text'];
  return typeof nested === 'string' || typeof nested === 'number' ? String(nested) : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}
