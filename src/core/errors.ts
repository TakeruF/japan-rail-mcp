import { z } from 'zod';
import type { Station } from './schemas.js';

export const railErrorCodeSchema = z.enum([
  'STATION_NOT_FOUND',
  'AMBIGUOUS_STATION',
  'TRAIN_NOT_FOUND',
  'JOURNEY_NOT_FOUND',
  'INVALID_DATE',
  'INVALID_TIME',
  'INVALID_CONFIGURATION',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RESPONSE_CHANGED',
  'RATE_LIMITED',
  'UNSUPPORTED_FEATURE',
  'NETWORK_TIMEOUT',
]);

export type RailErrorCode = z.infer<typeof railErrorCodeSchema>;

export interface RailErrorOptions {
  candidates?: Station[];
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class RailError extends Error {
  readonly code: RailErrorCode;
  readonly candidates?: Station[];
  readonly details?: Record<string, unknown>;

  constructor(code: RailErrorCode, message: string, options: RailErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'RailError';
    this.code = code;
    if (options.candidates !== undefined) this.candidates = options.candidates;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function serializeRailError(error: unknown): {
  code: RailErrorCode;
  message: string;
  candidates?: Station[];
  details?: Record<string, unknown>;
} {
  if (error instanceof RailError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.candidates === undefined ? {} : { candidates: error.candidates }),
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    code: 'PROVIDER_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'The rail provider failed unexpectedly.',
  };
}
