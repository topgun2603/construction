/**
 * A meeting is booked on the company's clock — "10:00 at the site" — but stored and sent to Outlook
 * as an instant. A `datetime-local` input gives a wall time with no zone, so these turn it into an
 * instant in the company's time zone and back, whatever zone the browser happens to be in.
 */

/** `2026-10-12T10:00` on `Asia/Kolkata`'s clock → `2026-10-12T04:30:00.000Z`. */
export function wallTimeToIso(local: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error('expected YYYY-MM-DDTHH:mm');
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at that moment, then once more at the corrected moment, so a time either side
  // of a daylight-saving change lands on the offset that applies to it.
  let instant = asUtc - offsetMinutes(asUtc, timeZone) * 60_000;
  instant = asUtc - offsetMinutes(instant, timeZone) * 60_000;
  return new Date(instant).toISOString();
}

/** An instant → `2026-10-12T10:00` on the zone's clock, for a `datetime-local` input. */
export function isoToWallTime(iso: string, timeZone: string): string {
  const parts = partsIn(new Date(iso).getTime(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function offsetMinutes(at: number, timeZone: string): number {
  const parts = partsIn(at, timeZone);
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return Math.round((wall - Math.floor(at / 60_000) * 60_000) / 60_000);
}

function partsIn(at: number, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      calendar: 'gregory',
      numberingSystem: 'latn',
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  );
}
