import { firesIn, nextRun, tickWindow } from './tenant-clock';

/** The tick that runs at `iso`, judged on the quarter-hour it was scheduled for. */
const tickAt = (iso: string) => tickWindow(new Date(iso));

describe('tenant clock', () => {
  const SUMMARY = '0 19 * * *';

  it('fires a 7 pm summary at 7 pm in each zone, once', () => {
    // 7 pm Kolkata = 13:30 UTC; 7 pm Dubai = 15:00 UTC; 7 pm Kathmandu = 13:15 UTC.
    expect(firesIn(SUMMARY, 'Asia/Kolkata', tickAt('2026-10-05T13:30:04Z'))).toBe(true);
    expect(firesIn(SUMMARY, 'Asia/Dubai', tickAt('2026-10-05T15:00:04Z'))).toBe(true);
    expect(firesIn(SUMMARY, 'Asia/Kathmandu', tickAt('2026-10-05T13:15:04Z'))).toBe(true);

    // And not on the neighbouring ticks.
    expect(firesIn(SUMMARY, 'Asia/Kolkata', tickAt('2026-10-05T13:15:04Z'))).toBe(false);
    expect(firesIn(SUMMARY, 'Asia/Kolkata', tickAt('2026-10-05T13:45:04Z'))).toBe(false);
    expect(firesIn(SUMMARY, 'Asia/Dubai', tickAt('2026-10-05T13:30:04Z'))).toBe(false);
  });

  it('counts a late tick against the boundary it was scheduled for', () => {
    // Ran ten minutes late; still the 13:30 tick, still Kolkata's 7 pm.
    expect(firesIn(SUMMARY, 'Asia/Kolkata', tickAt('2026-10-05T13:40:00Z'))).toBe(true);
  });

  it('fires exactly once across a whole day of ticks', () => {
    for (const zone of ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka']) {
      let fired = 0;
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const at = new Date(Date.UTC(2026, 9, 5) + minute * 60_000 + 3_000);
        if (firesIn(SUMMARY, zone, tickWindow(at))) fired += 1;
      }
      expect(fired).toBe(1);
    }
  });

  it('gives the next run on the company’s clock', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    expect(nextRun(SUMMARY, 'Asia/Kolkata', now)).toBe('2026-10-05T13:30:00.000Z');
    expect(nextRun(SUMMARY, 'Asia/Dubai', now)).toBe('2026-10-05T15:00:00.000Z');
  });
});
