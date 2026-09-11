import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformDb } from './platform-db.service';

/**
 * Analytics for the platform console.
 *
 * Raw SQL rather than Prisma's query builder, for two reasons. The aggregates are
 * `date_trunc` + `GROUP BY` shapes the builder cannot express, and these tables are the
 * only ones in the system that grow with the whole business rather than with one
 * builder — pulling a year of attendance into Node to bucket it by week would be the
 * slowest page in the product.
 *
 * Weeks and days are bucketed in `Asia/Kolkata` explicitly. `created_at` is a
 * `timestamptz`, so truncating it without a zone would bucket by UTC and move every
 * Monday boundary 5½ hours — enough to land a Sunday-evening signup in the wrong week.
 * Columns that are already plain dates (`attendance_date`, `report_date`) carry no zone
 * and need no conversion.
 *
 * There is deliberately no revenue figure here. Billing is not built (spec §16 step 12),
 * so plan prices exist nowhere in this system, and a console that displayed an invented
 * MRR would be displaying the one number an operator would actually act on.
 */
@Injectable()
export class PlatformAnalytics {
  constructor(private readonly db: PlatformDb) {}

  async overview(weeks: number) {
    const sinceWeeks = `${weeks} weeks`;

    const [signups, funnel, activity, volume, dormant, leaders, planMix] = await Promise.all([
      this.signupsByWeek(sinceWeeks),
      this.funnel(),
      this.activeTenantsByWeek(sinceWeeks),
      this.dailyVolume(),
      this.dormantTenants(),
      this.leaderboard(),
      this.planMixByWeek(sinceWeeks),
    ]);

    return { weeks, signups, funnel, activity, volume, dormant, leaders, plan_mix: planMix };
  }

  /** New tenants per week, with a running total so the shape of growth is visible. */
  private async signupsByWeek(since: string) {
    const rows = await this.db.client.$queryRaw<Array<{ week: Date; count: number }>>(Prisma.sql`
      SELECT date_trunc('week', created_at AT TIME ZONE 'Asia/Kolkata')::date AS week,
             count(*)::int AS count
      FROM tenants
      WHERE created_at >= now() - ${since}::interval
      GROUP BY 1
      ORDER BY 1
    `);

    let cumulative = 0;
    return rows.map((row) => {
      cumulative += row.count;
      return { week: iso(row.week), count: row.count, cumulative };
    });
  }

  /**
   * The activation funnel: how far each tenant got.
   *
   * Counted as "has ever done this", not "did it in order" — a tenant who recorded
   * attendance before filing a report still counts for both, because the question is
   * where accounts stall, not what sequence they followed.
   *
   * Every step is a `count(DISTINCT tenant_id)`, so the numbers only ever fall from one
   * step to the next and the drop-off between them is real.
   */
  private async funnel() {
    const [row] = await this.db.client.$queryRaw<
      Array<{
        signed_up: number;
        invited: number;
        created_site: number;
        added_workers: number;
        took_roll_call: number;
        filed_report: number;
      }>
    >(Prisma.sql`
      SELECT
        (SELECT count(*)::int FROM tenants)                                               AS signed_up,
        (SELECT count(*)::int FROM (
           SELECT tenant_id FROM users WHERE deleted_at IS NULL
           GROUP BY tenant_id HAVING count(*) > 1
         ) invited_more_than_owner)                                                       AS invited,
        (SELECT count(DISTINCT tenant_id)::int FROM projects WHERE deleted_at IS NULL)     AS created_site,
        (SELECT count(DISTINCT tenant_id)::int FROM workers  WHERE deleted_at IS NULL)     AS added_workers,
        (SELECT count(DISTINCT tenant_id)::int FROM attendance)                            AS took_roll_call,
        (SELECT count(DISTINCT tenant_id)::int FROM daily_reports
           WHERE deleted_at IS NULL AND status = 'submitted')                              AS filed_report
    `);

    const steps = [
      { key: 'signed_up', label: 'Signed up', count: row?.signed_up ?? 0 },
      { key: 'invited', label: 'Invited a colleague', count: row?.invited ?? 0 },
      { key: 'created_site', label: 'Created a site', count: row?.created_site ?? 0 },
      { key: 'added_workers', label: 'Added workers', count: row?.added_workers ?? 0 },
      { key: 'took_roll_call', label: 'Took a roll call', count: row?.took_roll_call ?? 0 },
      { key: 'filed_report', label: 'Filed a report', count: row?.filed_report ?? 0 },
    ];

    const top = steps[0]?.count ?? 0;
    return steps.map((step, index) => {
      const previous = index === 0 ? step.count : (steps[index - 1]?.count ?? 0);
      return {
        ...step,
        // Share of all signups, which is what makes the bars comparable down the page.
        percent: top === 0 ? 0 : Math.round((step.count / top) * 100),
        // Lost at this step specifically — the number that says where to spend effort.
        dropped: Math.max(previous - step.count, 0),
      };
    });
  }

  /**
   * Tenants that did real work each week, against the number that existed by then.
   *
   * "Active" means attendance or a daily report — work someone had to be on a site to
   * produce. Deliberately not sign-ins: an owner opening the dashboard, seeing nothing
   * and closing it would otherwise count as an active account, which is precisely the
   * tenant this chart needs to expose.
   *
   * The denominator is tenants that existed by the end of that week *or* did work in it,
   * which keeps early weeks from being flattered by dividing by today's tenant count.
   *
   * The "or did work in it" half is not defensive padding. Attendance carries the date it
   * happened, not the date it was typed, and back-entering a fortnight of muster rolls
   * after signing up is ordinary behaviour on a building site. Without it the numerator
   * could exceed the denominator and the percentage would be nonsense — which it was.
   */
  private async activeTenantsByWeek(since: string) {
    const rows = await this.db.client.$queryRaw<
      Array<{ week: Date; active: number; existing: number }>
    >(Prisma.sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata') - ${since}::interval),
          date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata'),
          interval '1 week'
        )::date AS week
      ),
      worked AS (
        SELECT date_trunc('week', attendance_date)::date AS week, tenant_id FROM attendance
        UNION
        SELECT date_trunc('week', report_date)::date AS week, tenant_id
        FROM daily_reports WHERE deleted_at IS NULL AND status = 'submitted'
      )
      SELECT w.week,
             (SELECT count(DISTINCT tenant_id)::int FROM worked
               WHERE worked.week = w.week)                                        AS active,
             (SELECT count(*)::int FROM (
                SELECT id AS tenant_id FROM tenants
                  WHERE date_trunc('week', created_at AT TIME ZONE 'Asia/Kolkata')::date <= w.week
                UNION
                SELECT tenant_id FROM worked WHERE worked.week = w.week
              ) present)                                                          AS existing
      FROM weeks w
      ORDER BY w.week
    `);

    return rows.map((row) => ({
      week: iso(row.week),
      active: row.active,
      existing: row.existing,
      percent: row.existing === 0 ? 0 : Math.round((row.active / row.existing) * 100),
    }));
  }

  /**
   * What the platform processed each day for the last 30 days.
   *
   * One query with a generated date spine rather than three queries merged in Node, so a
   * day nobody worked comes back as a zero instead of a gap the chart has to guess at.
   */
  private async dailyVolume() {
    const rows = await this.db.client.$queryRaw<
      Array<{ day: Date; attendance: number; reports: number; expenses: number }>
    >(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '29 days',
          (now() AT TIME ZONE 'Asia/Kolkata')::date,
          interval '1 day'
        )::date AS day
      )
      SELECT d.day,
             (SELECT count(*)::int FROM attendance a WHERE a.attendance_date = d.day) AS attendance,
             (SELECT count(*)::int FROM daily_reports r
               WHERE r.report_date = d.day AND r.deleted_at IS NULL)                  AS reports,
             (SELECT count(*)::int FROM expenses e
               WHERE e.spent_on = d.day AND e.deleted_at IS NULL)                     AS expenses
      FROM days d
      ORDER BY d.day
    `);

    return rows.map((row) => ({
      day: iso(row.day),
      attendance: row.attendance,
      reports: row.reports,
      expenses: row.expenses,
    }));
  }

  /**
   * Accounts that have gone quiet — the actionable list on this page.
   *
   * Ordered by how long they have been silent, with tenants that never did anything at
   * all first: a builder who signed up and never created a site is a different (and
   * easier) conversation than one who worked for three months and stopped.
   *
   * Suspended and cancelled tenants are excluded. They are not quiet, they are switched
   * off, and mixing the two turns a follow-up list into noise.
   */
  private async dormantTenants() {
    const rows = await this.db.client.$queryRaw<
      Array<{
        id: string;
        name: string;
        plan: string;
        created_at: Date;
        last_work: Date | null;
        quiet_days: number | null;
      }>
    >(Prisma.sql`
      WITH last_work AS (
        SELECT tenant_id, max(day) AS day FROM (
          SELECT tenant_id, attendance_date AS day FROM attendance
          UNION ALL
          SELECT tenant_id, report_date AS day FROM daily_reports WHERE deleted_at IS NULL
        ) work GROUP BY tenant_id
      )
      SELECT t.id::text, t.name, t.plan::text, t.created_at,
             lw.day AS last_work,
             CASE WHEN lw.day IS NULL THEN NULL
                  ELSE ((now() AT TIME ZONE 'Asia/Kolkata')::date - lw.day)
             END::int AS quiet_days
      FROM tenants t
      LEFT JOIN last_work lw ON lw.tenant_id = t.id
      WHERE t.status = 'active'
        AND (lw.day IS NULL OR lw.day < (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '13 days')
      ORDER BY lw.day IS NULL DESC, lw.day ASC
      LIMIT 25
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      plan: row.plan,
      created_at: row.created_at.toISOString(),
      last_work: row.last_work ? iso(row.last_work) : null,
      quiet_days: row.quiet_days,
    }));
  }

  /** Busiest accounts by the work they actually put through, last 30 days. */
  private async leaderboard() {
    const rows = await this.db.client.$queryRaw<
      Array<{ id: string; name: string; plan: string; attendance: number; reports: number }>
    >(Prisma.sql`
      SELECT t.id::text, t.name, t.plan::text,
             (SELECT count(*)::int FROM attendance a
               WHERE a.tenant_id = t.id
                 AND a.attendance_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '29 days'
             ) AS attendance,
             (SELECT count(*)::int FROM daily_reports r
               WHERE r.tenant_id = t.id AND r.deleted_at IS NULL
                 AND r.report_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '29 days'
             ) AS reports
      FROM tenants t
      WHERE t.status = 'active'
      ORDER BY attendance DESC, reports DESC
      LIMIT 10
    `);

    return rows
      .filter((row) => row.attendance > 0 || row.reports > 0)
      .map((row) => ({
        id: row.id,
        name: row.name,
        plan: row.plan,
        attendance: row.attendance,
        reports: row.reports,
      }));
  }

  /**
   * Plan mix as it stood at the end of each week.
   *
   * Built from `tenants.created_at` against today's plan, so it answers "how many
   * tenants existed then, split by the plan they are on now" — not a true history of
   * upgrades. Recording that properly needs a plan-change log, which arrives with
   * billing; until then this is honest about being a snapshot view.
   */
  private async planMixByWeek(since: string) {
    const rows = await this.db.client.$queryRaw<
      Array<{ week: Date; starter: number; pro: number }>
    >(Prisma.sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata') - ${since}::interval),
          date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata'),
          interval '1 week'
        )::date AS week
      )
      SELECT w.week,
             (SELECT count(*)::int FROM tenants
               WHERE plan = 'starter'
                 AND date_trunc('week', created_at AT TIME ZONE 'Asia/Kolkata')::date <= w.week
             ) AS starter,
             (SELECT count(*)::int FROM tenants
               WHERE plan = 'pro'
                 AND date_trunc('week', created_at AT TIME ZONE 'Asia/Kolkata')::date <= w.week
             ) AS pro
      FROM weeks w
      ORDER BY w.week
    `);

    return rows.map((row) => ({ week: iso(row.week), starter: row.starter, pro: row.pro }));
  }
}

/** A `date` column as `YYYY-MM-DD`. */
function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}
