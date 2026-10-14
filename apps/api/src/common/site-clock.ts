import { siteTimeZone, todayIn } from '@sitebook/shared';

/**
 * A site's own clock (a separate time zone per site).
 *
 * A company keeps one zone; a site may keep another (`projects.time_zone`). Everything that asks
 * "what day is it at this site" — the roll call, a daily report's date, a safety record's local
 * time, a machine's daily log — reads it through here, so the rule (`siteTimeZone`: the site's
 * zone, else the company's) lives in one place. Company-wide things — wage periods, billing, the
 * overnight jobs — stay on the company zone and do not come here.
 *
 * The functions take whatever Prisma client the caller already holds — a tenant transaction or
 * the one-shot tenant client — so a lookup never escapes the caller's tenant context.
 */
interface ProjectZoneReader {
  project: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; timeZone: true };
    }): Promise<Array<{ id: string; timeZone: string | null }>>;
  };
}

/** Each site's zone, for a set of sites; unknown ids fall back to the company's zone. */
export async function siteZones(
  db: ProjectZoneReader,
  actor: { timezone: string },
  projectIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds)];
  const zones = new Map<string, string>();
  if (ids.length === 0) return zones;
  const rows = await db.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, timeZone: true },
  });
  for (const row of rows) zones.set(row.id, siteTimeZone(row, actor));
  for (const id of ids) if (!zones.has(id)) zones.set(id, actor.timezone);
  return zones;
}

/** One site's zone. */
export async function siteZone(
  db: ProjectZoneReader,
  actor: { timezone: string },
  projectId: string,
): Promise<string> {
  return (await siteZones(db, actor, [projectId])).get(projectId) ?? actor.timezone;
}

/** Today at the site, `YYYY-MM-DD`. */
export async function siteToday(
  db: ProjectZoneReader,
  actor: { timezone: string },
  projectId: string,
  now: Date = new Date(),
): Promise<string> {
  return todayIn(await siteZone(db, actor, projectId), now);
}

/**
 * The caller as seen from a site: the same person with the site's clock. Lets the many helpers
 * that read `actor.timezone` (safety's `companyInstant`, `companyDay`, …) work on site time
 * without each growing a zone parameter.
 */
export function atSite<T extends { timezone: string }>(actor: T, zone: string | undefined): T {
  return zone && zone !== actor.timezone ? { ...actor, timezone: zone } : actor;
}

/** `atSite` for one site, looked up. */
export async function siteActor<T extends { timezone: string }>(
  db: ProjectZoneReader,
  actor: T,
  projectId: string,
): Promise<T> {
  return atSite(actor, await siteZone(db, actor, projectId));
}
