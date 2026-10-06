import { todayIn, type IsoDate } from './dates';

/**
 * A separate time zone per site.
 *
 * A company keeps one zone for itself — wage periods, billing, the overnight jobs — but its sites
 * can sit in different ones: a Mumbai company with a Dubai site wants that site's roll call to
 * turn over to tomorrow at Dubai midnight, not ninety minutes earlier. A site with no zone of its
 * own keeps the company's, so every existing site reads exactly as before.
 *
 * Accepts both spellings of the field — `time_zone` off the wire, `timeZone` off a Prisma row —
 * so the API and the web share one rule.
 */
type SiteZoneSource =
  | { time_zone?: string | null; timeZone?: string | null }
  | null
  | undefined;

export function siteTimeZone(site: SiteZoneSource, company: { timezone: string }): string {
  return site?.time_zone || site?.timeZone || company.timezone;
}

/** The calendar date it is now at the site — what attendance and a daily report mean by "today". */
export function siteTimeToday(
  site: SiteZoneSource,
  company: { timezone: string },
  now: Date = new Date(),
): IsoDate {
  return todayIn(siteTimeZone(site, company), now);
}

/** True when the site keeps a zone other than the company's, so the screen should say which. */
export function siteTimeZoneDiffers(site: SiteZoneSource, company: { timezone: string }): boolean {
  return siteTimeZone(site, company) !== company.timezone;
}

/**
 * A short hint for a site whose clock is not the company's: "Dubai · GMT+4". The city is the last
 * part of the IANA name, which is what people recognise; the offset is the runtime's own.
 */
export function siteTimeZoneHint(zone: string, at: Date = new Date()): string {
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;
  let offset = '';
  try {
    offset =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(at)
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    offset = '';
  }
  return offset ? `${city} · ${offset}` : city;
}
