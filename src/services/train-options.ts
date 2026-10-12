import { z } from 'zod';
import { RailError } from '../core/errors.js';
import { sourceSchema, type Train } from '../core/schemas.js';

export const personalConstraintsShape = {
  stationReadyAt: z.iso
    .datetime({ offset: true })
    .describe('Time you reach the departure station, with an explicit offset.'),
  boardingBufferMinutes: z.number().int().min(0).max(180).default(10),
  exitBufferMinutes: z.number().int().min(0).max(180).default(0),
  arriveBy: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Deadline after the destination-station exit buffer.'),
  maxFareJPY: z.number().int().nonnegative().optional(),
  seatClassId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Exact normalized seat class, e.g. reserved or green; requires a matching total fare.',
    ),
};
export const personalConstraintsSchema = z.object(personalConstraintsShape);
export type PersonalConstraints = z.infer<typeof personalConstraintsSchema>;

const optionSchema = z.object({
  trainId: z.string(),
  trainNumber: z.string(),
  departureTime: z.iso.datetime({ offset: true }),
  arrivalTime: z.iso.datetime({ offset: true }),
  readyAtDestination: z.iso.datetime({ offset: true }),
  latestStationArrival: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().nonnegative(),
  fareJPY: z.number().int().nonnegative().nullable(),
  fareSeatClassId: z.string().nullable(),
  source: sourceSchema,
});
export const trainOptionsSchema = z.object({
  evaluatedAt: z.iso.datetime({ offset: true }),
  dataMode: z.enum(['saved_search_snapshot', 'provider_search']),
  constraints: personalConstraintsSchema,
  considered: z.number().int().nonnegative(),
  feasible: z.array(optionSchema),
  excluded: z.array(
    z.object({
      trainId: z.string(),
      reasons: z.array(
        z.enum([
          'boarding_buffer',
          'arrival_deadline',
          'fare_unknown',
          'budget',
          'seat_class_fare_unknown',
        ]),
      ),
    }),
  ),
  picks: z.object({
    cheapest: z.string().nullable(),
    fastest: z.string().nullable(),
    earliestArrival: z.string().nullable(),
  }),
  cheapestTradeoff: z
    .object({
      comparedWithTrainId: z.string(),
      savingsJPY: z.number().int().nonnegative().nullable(),
      extraMinutes: z.number().nonnegative(),
    })
    .nullable(),
  notes: z.array(z.string()),
});

export function tokyoTimestamp(milliseconds: number): string {
  return new Date(milliseconds + 9 * 60 * 60_000).toISOString().slice(0, 19) + '+09:00';
}

export function evaluateTrainOptions(
  trains: Train[],
  constraints: PersonalConstraints,
  now: Date,
  dataMode: 'saved_search_snapshot' | 'provider_search' = 'saved_search_snapshot',
) {
  const ready = Date.parse(constraints.stationReadyAt);
  const deadline =
    constraints.arriveBy === undefined ? undefined : Date.parse(constraints.arriveBy);
  if (deadline !== undefined && deadline < ready) {
    throw new RailError('INVALID_TIME', 'arriveBy must not be earlier than stationReadyAt.');
  }
  const first = trains[0];
  if (
    first &&
    trains.some(
      (train) =>
        train.origin.id !== first.origin.id ||
        train.destination.id !== first.destination.id ||
        train.departureTime.slice(0, 10) !== first.departureTime.slice(0, 10),
    )
  ) {
    throw new RailError(
      'INVALID_DATE',
      'Compare trains for the same station pair and Japan-local departure date.',
    );
  }
  const feasible: z.infer<typeof optionSchema>[] = [];
  const excluded: z.infer<typeof trainOptionsSchema>['excluded'] = [];
  for (const train of trains) {
    const fares = train.fares
      .filter(
        (fare) =>
          fare.kind === 'total' &&
          (constraints.seatClassId === undefined || fare.seatClassId === constraints.seatClassId),
      )
      .sort((a, b) => a.amount - b.amount);
    const fare = fares[0];
    const departure = Date.parse(train.departureTime);
    const destinationReady = Date.parse(train.arrivalTime) + constraints.exitBufferMinutes * 60_000;
    const latestArrival = departure - constraints.boardingBufferMinutes * 60_000;
    const reasons: z.infer<typeof trainOptionsSchema>['excluded'][number]['reasons'] = [];
    if (ready > latestArrival) reasons.push('boarding_buffer');
    if (deadline !== undefined && destinationReady > deadline) reasons.push('arrival_deadline');
    if (constraints.seatClassId !== undefined && !fare) reasons.push('seat_class_fare_unknown');
    if (constraints.maxFareJPY !== undefined) {
      if (!fare) reasons.push('fare_unknown');
      else if (fare.amount > constraints.maxFareJPY) reasons.push('budget');
    }
    if (reasons.length) {
      excluded.push({ trainId: train.id, reasons });
      continue;
    }
    feasible.push({
      trainId: train.id,
      trainNumber: train.trainNumber,
      departureTime: train.departureTime,
      arrivalTime: train.arrivalTime,
      readyAtDestination: tokyoTimestamp(destinationReady),
      latestStationArrival: tokyoTimestamp(latestArrival),
      durationMinutes: train.durationMinutes,
      fareJPY: fare?.amount ?? null,
      fareSeatClassId: fare?.seatClassId ?? null,
      source: train.source,
    });
  }
  feasible.sort(
    (a, b) =>
      a.readyAtDestination.localeCompare(b.readyAtDestination) ||
      a.trainId.localeCompare(b.trainId),
  );
  const earliest = feasible[0];
  const fastest = [...feasible].sort(
    (a, b) =>
      a.durationMinutes - b.durationMinutes ||
      a.readyAtDestination.localeCompare(b.readyAtDestination),
  )[0];
  const cheapest = feasible
    .filter((option) => option.fareJPY !== null)
    .sort(
      (a, b) => a.fareJPY! - b.fareJPY! || a.readyAtDestination.localeCompare(b.readyAtDestination),
    )[0];
  return trainOptionsSchema.parse({
    evaluatedAt: now.toISOString(),
    dataMode,
    constraints,
    considered: trains.length,
    feasible,
    excluded,
    picks: {
      cheapest: cheapest?.trainId ?? null,
      fastest: fastest?.trainId ?? null,
      earliestArrival: earliest?.trainId ?? null,
    },
    cheapestTradeoff:
      cheapest && earliest
        ? {
            comparedWithTrainId: earliest.trainId,
            savingsJPY: earliest.fareJPY === null ? null : earliest.fareJPY - cheapest.fareJPY!,
            extraMinutes:
              (Date.parse(cheapest.readyAtDestination) - Date.parse(earliest.readyAtDestination)) /
              60_000,
          }
        : null,
    notes: [
      dataMode === 'saved_search_snapshot'
        ? 'No provider request was made. These are previously retrieved search results, not refreshed schedules or seat inventory.'
        : 'One provider search was made. Results are published schedules and fares, not verified seat inventory.',
      'Station buffers are user-supplied allowances, not measured indoor walking times. Fastest means shortest train ride.',
      'Prices are published total fares; no commuter-pass deduction or booking discount is applied. Picks cover only the supplied candidates, not all trains on this route.',
    ],
  });
}
