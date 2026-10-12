import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { RailError } from './errors.js';
import { personalConstraintsSchema, personalConstraintsShape } from '../services/train-options.js';

const buffer = z.number().int().min(0).max(180).optional();
const defaultsSchema = z
  .object({
    boardingBufferMinutes: buffer,
    exitBufferMinutes: buffer,
    maxFareJPY: personalConstraintsShape.maxFareJPY,
    seatClassId: personalConstraintsShape.seatClassId,
  })
  .strict();
export const preferencesSchema = z
  .object({
    defaults: defaultsSchema.default({}),
    stations: z
      .record(
        z.string().regex(/^jp:station:[a-z0-9-]+$/),
        z.object({ boardingBufferMinutes: buffer, exitBufferMinutes: buffer }).strict(),
      )
      .default({}),
  })
  .strict();
export type PersonalPreferences = z.infer<typeof preferencesSchema>;
export const personalInputShape = {
  stationReadyAt: personalConstraintsShape.stationReadyAt,
  boardingBufferMinutes: buffer,
  exitBufferMinutes: buffer,
  arriveBy: personalConstraintsShape.arriveBy,
  maxFareJPY: personalConstraintsShape.maxFareJPY
    .unwrap()
    .nullable()
    .optional()
    .describe('Override saved budget; null removes it.'),
  seatClassId: personalConstraintsShape.seatClassId
    .unwrap()
    .nullable()
    .optional()
    .describe('Override saved seat class; null removes it.'),
};
export const personalInputSchema = z.object(personalInputShape);
export type PersonalInput = z.infer<typeof personalInputSchema>;

export function loadPersonalPreferences(env: NodeJS.ProcessEnv): PersonalPreferences {
  const explicitPath = env.JAPAN_RAIL_PREFERENCES_FILE;
  const path = explicitPath || join(homedir(), '.config', 'japan-rail-mcp', 'preferences.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (!explicitPath && error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return preferencesSchema.parse({});
    throw new RailError(
      'INVALID_CONFIGURATION',
      'Cannot read personal preferences file. Check JAPAN_RAIL_PREFERENCES_FILE and file permissions.',
    );
  }
  try {
    return preferencesSchema.parse(JSON.parse(text));
  } catch {
    throw new RailError(
      'INVALID_CONFIGURATION',
      'Personal preferences must be valid JSON matching the documented preferences schema.',
    );
  }
}

export function resolvePersonalConstraints(
  input: PersonalInput,
  preferences: PersonalPreferences,
  origin: string,
  destination: string,
) {
  const merged: Record<string, unknown> = { ...preferences.defaults };
  const boarding = preferences.stations[origin]?.boardingBufferMinutes;
  const exit = preferences.stations[destination]?.exitBufferMinutes;
  if (boarding !== undefined) merged.boardingBufferMinutes = boarding;
  if (exit !== undefined) merged.exitBufferMinutes = exit;
  for (const [key, value] of Object.entries(input)) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  return personalConstraintsSchema.parse(merged);
}
