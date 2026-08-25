import { RailError } from './errors.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const TOKYO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\+09:00$/;

export function assertDate(date: string): void {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RailError('INVALID_DATE', 'Use YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new RailError('INVALID_DATE', `Invalid calendar date: ${date}.`);
  }
}

export function assertNotPastDate(date: string, now = new Date()): void {
  assertDate(date);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (date < today) {
    throw new RailError('INVALID_DATE', `Past travel dates are not supported: ${date}.`);
  }
}

export function assertTime(time: string): void {
  const match = TIME_PATTERN.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new RailError('INVALID_TIME', 'Use a valid 24-hour HH:MM time.');
  }
}

export function assertTokyoTimestamp(timestamp: string): void {
  if (!TOKYO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new RailError(
      'PROVIDER_RESPONSE_CHANGED',
      `Expected an explicit Asia/Tokyo timestamp, received: ${timestamp}.`,
    );
  }
}

export function minutesBetween(start: string, end: string): number {
  assertTokyoTimestamp(start);
  assertTokyoTimestamp(end);
  return Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
}

export function timePart(timestamp: string): string {
  assertTokyoTimestamp(timestamp);
  return timestamp.slice(11, 16);
}
