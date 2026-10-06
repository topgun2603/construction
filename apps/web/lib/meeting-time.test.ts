import { describe, expect, it } from 'vitest';
import { isoToWallTime, wallTimeToIso } from './meeting-time';

describe('meeting times on the company clock', () => {
  it('reads a wall time in the company zone, not the browser’s', () => {
    expect(wallTimeToIso('2026-10-12T10:00', 'Asia/Kolkata')).toBe('2026-10-12T04:30:00.000Z');
    expect(wallTimeToIso('2026-10-12T10:00', 'Asia/Dubai')).toBe('2026-10-12T06:00:00.000Z');
    expect(wallTimeToIso('2026-10-12T10:00', 'UTC')).toBe('2026-10-12T10:00:00.000Z');
  });

  it('uses the offset in force on the day, either side of daylight saving', () => {
    expect(wallTimeToIso('2026-07-01T09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(wallTimeToIso('2026-12-01T09:00', 'Europe/London')).toBe('2026-12-01T09:00:00.000Z');
  });

  it('round-trips back to the input', () => {
    for (const zone of ['Asia/Kolkata', 'Asia/Riyadh', 'Pacific/Kiritimati', 'America/New_York']) {
      expect(isoToWallTime(wallTimeToIso('2026-03-15T17:45', zone), zone)).toBe('2026-03-15T17:45');
    }
  });
});
