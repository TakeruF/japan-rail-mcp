import { z } from 'zod';

export const sourceSchema = z.object({
  provider: z.string().min(1),
  dataset: z.string().min(1).optional(),
  retrievedAt: z.iso.datetime({ offset: true }),
  lastUpdated: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  isRealtime: z.boolean(),
});

export const stationRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  localName: z.string().min(1),
  englishName: z.string().min(1).optional(),
});

export const japanStationExtensionSchema = z.object({
  shinkansenLines: z.array(z.string()),
  providerNames: z.record(z.string(), z.string()),
});

export const stationSchema = stationRefSchema.extend({
  aliases: z.array(z.string()),
  countryCode: z.literal('JP'),
  operators: z.array(z.string()),
  prefecture: z.string().min(1).optional(),
  extensions: z.object({ japan: japanStationExtensionSchema }),
  source: sourceSchema,
});

export const fareSchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.literal('JPY'),
  formatted: z.string().min(1).optional(),
  kind: z.enum(['base', 'limited_express', 'total']),
  seatClassId: z.string().min(1).optional(),
});

export const seatClassSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  localName: z.string().min(1),
  providerLabel: z.string().min(1).optional(),
});

export const japanTrainExtensionSchema = z.object({
  shinkansenLine: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  passengerFacingNumber: z.string().min(1),
  operationalTrainNumber: z.string().min(1).optional(),
  providerTrainId: z.string().min(1).optional(),
});

export const trainSchema = z.object({
  id: z.string().min(1),
  trainNumber: z.string().min(1),
  trainName: z.string().min(1).optional(),
  origin: stationRefSchema,
  destination: stationRefSchema,
  departureTime: z.iso.datetime({ offset: true }),
  arrivalTime: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().nonnegative(),
  operator: z.string().min(1).optional(),
  serviceType: z.literal('shinkansen'),
  transferCount: z.literal(0),
  fares: z.array(fareSchema),
  seatClasses: z.array(seatClassSchema),
  source: sourceSchema,
  extensions: z.object({ japan: japanTrainExtensionSchema }),
});

export const trainStopSchema = z.object({
  sequence: z.number().int().positive(),
  station: stationRefSchema,
  arrivalTime: z.iso.datetime({ offset: true }).nullable(),
  departureTime: z.iso.datetime({ offset: true }).nullable(),
});

export const trainDetailsSchema = z.object({
  train: trainSchema,
  stops: z.array(trainStopSchema),
  source: sourceSchema,
});

export const journeyLegSchema = z.object({
  mode: z.enum(['train', 'walk', 'other']),
  train: trainSchema.optional(),
  from: stationRefSchema,
  to: stationRefSchema,
  departureTime: z.iso.datetime({ offset: true }).optional(),
  arrivalTime: z.iso.datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().nonnegative(),
});

export const journeySchema = z.object({
  id: z.string().min(1),
  origin: stationRefSchema,
  destination: stationRefSchema,
  departureTime: z.iso.datetime({ offset: true }),
  arrivalTime: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().nonnegative(),
  transferCount: z.number().int().nonnegative(),
  fares: z.array(fareSchema),
  legs: z.array(journeyLegSchema),
  source: sourceSchema,
});

export const availabilitySchema = z.object({
  status: z.enum(['available', 'unavailable', 'limited', 'unknown', 'unsupported']),
  reason: z.string().min(1).optional(),
  retrievedAt: z.iso.datetime({ offset: true }),
  seats: z
    .array(
      z.object({
        seatClass: seatClassSchema,
        status: z.enum(['available', 'unavailable', 'limited', 'unknown']),
        count: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  source: sourceSchema.optional(),
});

export const railProviderCapabilitiesSchema = z.object({
  stationSearch: z.boolean(),
  timetable: z.boolean(),
  trainStops: z.boolean(),
  fares: z.boolean(),
  availability: z.boolean(),
  journeySearch: z.boolean(),
});

export type Source = z.infer<typeof sourceSchema>;
export type StationRef = z.infer<typeof stationRefSchema>;
export type Station = z.infer<typeof stationSchema>;
export type Fare = z.infer<typeof fareSchema>;
export type SeatClass = z.infer<typeof seatClassSchema>;
export type Train = z.infer<typeof trainSchema>;
export type TrainStop = z.infer<typeof trainStopSchema>;
export type TrainDetails = z.infer<typeof trainDetailsSchema>;
export type Journey = z.infer<typeof journeySchema>;
export type SeatAvailability = z.infer<typeof availabilitySchema>;
export type RailProviderCapabilities = z.infer<typeof railProviderCapabilitiesSchema>;

export function toStationRef(station: Station): StationRef {
  return {
    id: station.id,
    name: station.name,
    localName: station.localName,
    ...(station.englishName === undefined ? {} : { englishName: station.englishName }),
  };
}
