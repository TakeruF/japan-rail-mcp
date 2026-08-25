import { describe, expect, it } from 'vitest';
import {
  assertDate,
  assertNotPastDate,
  assertTokyoTimestamp,
  assertTime,
} from '../src/core/date.js';

describe('date and Asia/Tokyo handling', () => {
  it('accepts a valid explicit date', () => expect(() => assertDate('2026-08-26')).not.toThrow());

  it.each(['2026-02-30', '2026-13-01', '26-08-01'])('rejects invalid date %s', (date) => {
    expect(() => assertDate(date)).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
  });

  it('rejects past provider queries using the Tokyo calendar date', () => {
    const nearMidnightUtc = new Date('2026-08-25T15:30:00Z');
    expect(() => assertNotPastDate('2026-08-25', nearMidnightUtc)).toThrow(
      expect.objectContaining({ code: 'INVALID_DATE' }),
    );
    expect(() => assertNotPastDate('2026-08-26', nearMidnightUtc)).not.toThrow();
  });

  it('requires valid HH:MM values', () => {
    expect(() => assertTime('23:59')).not.toThrow();
    expect(() => assertTime('24:00')).toThrow(expect.objectContaining({ code: 'INVALID_TIME' }));
  });

  it('rejects timezone-free and non-Tokyo provider timestamps', () => {
    expect(() => assertTokyoTimestamp('2026-08-26T12:03:00+09:00')).not.toThrow();
    expect(() => assertTokyoTimestamp('2026-08-26T12:03:00')).toThrow();
    expect(() => assertTokyoTimestamp('2026-08-26T03:03:00Z')).toThrow();
  });
});
