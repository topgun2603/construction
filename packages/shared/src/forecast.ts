import { addDays, daysBetweenInclusive, type IsoDate } from './dates';
import { formatMoneyCompact, type MoneyFormat } from './money';

/**
 * Overrun early warning (roadmap: AI agent 2).
 *
 * The forecast itself is arithmetic, not a model: an owner has to be able to check every figure
 * on the card against the ledger, and a number nobody can reproduce is a number nobody acts on.
 * The language model, where one is configured, only rewords the explanation built here
 * (`explainForecast`) — it is never asked for a figure.
 *
 * All money is integer minor units, all quantities thousandths, all percentages whole numbers.
 */

export interface ForecastInput {
  today: IsoDate;
  budget: bigint | null;
  startDate: IsoDate | null;
  targetEndDate: IsoDate | null;
  /** Every cost the site has incurred, one row per day and line: `Labour · Mason`, `Expense · fuel`. */
  spend: ReadonlyArray<{ date: IsoDate; line: string; amount: bigint }>;
  milestones: { total: number; done: number };
  /** Estimated and consumed quantity per material, in thousandths. */
  materials: ReadonlyArray<{ name: string; unit: string; estimated: bigint; consumed: bigint }>;
}

export type ForecastMethod = 'progress' | 'burn_rate' | 'spend_only';
export type ForecastSeverity = 'ok' | 'watch' | 'warning' | 'critical';

export type ForecastDriver =
  | {
      kind: 'spend_trend';
      line: string;
      /** Spend in the last 14 days and the 14 before. */
      recent: bigint;
      previous: bigint;
      /** Null when nothing was spent on this line in the earlier fortnight. */
      changePct: number | null;
    }
  | { kind: 'material'; name: string; unit: string; usedPct: number; progressPct: number | null }
  | { kind: 'schedule'; progressPct: number; elapsedPct: number }
  | { kind: 'overdue'; daysPast: number };

export interface SiteForecast {
  method: ForecastMethod;
  spent: bigint;
  budget: bigint | null;
  /** Expected total cost at completion. Null when there is nothing to project from. */
  forecast: bigint | null;
  /** `forecast - budget`; positive is over. */
  overrun: bigint | null;
  overrunPct: number | null;
  progressPct: number | null;
  elapsedPct: number | null;
  severity: ForecastSeverity;
  drivers: ForecastDriver[];
}

/** Thresholds, in one place so the card's wording and the flagging cannot drift apart. */
export const FORECAST_RULES = Object.freeze({
  /** Milestones needed before progress is trusted over the spend rate. */
  minMilestones: 3,
  /** Progress below this is too early to extrapolate from. */
  minProgressPct: 10,
  burnRateDays: 28,
  trendDays: 14,
  /** A cost line must rise at least this much fortnight on fortnight to be called out. */
  trendPct: 15,
  /** …and by at least this share of the budget, so a trivial line never crowds out a real one. */
  trendBudgetPct: 1,
  /** Materials used this far ahead of progress are called out. */
  materialAheadPct: 15,
  /** Progress this far behind elapsed time is a schedule warning. */
  scheduleBehindPct: 15,
  warningOverrunPct: 5,
  criticalOverrunPct: 15,
});

const pct = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number((part * 100n) / whole);

export function forecastSite(input: ForecastInput): SiteForecast {
  const { today, budget } = input;
  const spent = input.spend.reduce((sum, row) => sum + row.amount, 0n);

  // --- progress and time -----------------------------------------------------------------
  const { total, done } = input.milestones;
  const progressPct =
    total >= FORECAST_RULES.minMilestones ? Math.floor((done * 100) / total) : null;

  let elapsedPct: number | null = null;
  let daysLeft: number | null = null;
  if (input.startDate && input.targetEndDate && input.targetEndDate > input.startDate) {
    const span = daysBetweenInclusive(input.startDate, input.targetEndDate);
    const elapsed = today < input.startDate ? 0 : daysBetweenInclusive(input.startDate, today);
    elapsedPct = Math.min(100, Math.floor((elapsed * 100) / span));
    daysLeft =
      today >= input.targetEndDate ? 0 : daysBetweenInclusive(today, input.targetEndDate) - 1;
  }

  // --- the forecast -------------------------------------------------------------------------
  let method: ForecastMethod = 'spend_only';
  let forecast: bigint | null = null;

  if (progressPct !== null && progressPct >= FORECAST_RULES.minProgressPct && done > 0) {
    method = 'progress';
    // Cost so far scaled by work remaining: 40% of the milestones for 1.8M means 4.5M at the end.
    forecast = (spent * BigInt(total)) / BigInt(done);
  } else if (daysLeft !== null) {
    method = 'burn_rate';
    const from = addDays(today, -(FORECAST_RULES.burnRateDays - 1));
    const firstSpend = input.spend.reduce<IsoDate | null>(
      (first, row) => (first === null || row.date < first ? row.date : first),
      null,
    );
    // A site younger than the window is averaged over its own life, not over empty weeks.
    const windowStart = firstSpend && firstSpend > from ? firstSpend : from;
    const windowDays = firstSpend ? daysBetweenInclusive(windowStart, today) : 0;
    const windowSpend = input.spend
      .filter((row) => row.date >= windowStart && row.date <= today)
      .reduce((sum, row) => sum + row.amount, 0n);
    forecast =
      windowDays > 0 ? spent + (windowSpend * BigInt(daysLeft)) / BigInt(windowDays) : spent;
  }

  const overrun = forecast !== null && budget !== null ? forecast - budget : null;
  const overrunPct =
    overrun !== null && budget !== null && budget > 0n ? pct(overrun, budget) : null;

  // --- what is driving it -------------------------------------------------------------------
  const drivers: ForecastDriver[] = [];

  if (daysLeft === 0 && input.targetEndDate && today > input.targetEndDate) {
    drivers.push({
      kind: 'overdue',
      daysPast: daysBetweenInclusive(input.targetEndDate, today) - 1,
    });
  } else if (
    progressPct !== null &&
    elapsedPct !== null &&
    elapsedPct - progressPct >= FORECAST_RULES.scheduleBehindPct
  ) {
    drivers.push({ kind: 'schedule', progressPct, elapsedPct });
  }

  drivers.push(...spendTrends(input.spend, today, budget));

  for (const material of input.materials) {
    if (material.estimated <= 0n) continue;
    const usedPct = pct(material.consumed, material.estimated);
    const ahead =
      progressPct !== null
        ? usedPct - progressPct >= FORECAST_RULES.materialAheadPct
        : usedPct > 100;
    if (ahead) {
      drivers.push({
        kind: 'material',
        name: material.name,
        unit: material.unit,
        usedPct,
        progressPct,
      });
    }
  }

  // --- how worried to be --------------------------------------------------------------------
  let severity: ForecastSeverity = 'ok';
  const over = overrunPct ?? -1;
  if ((budget !== null && spent > budget) || over >= FORECAST_RULES.criticalOverrunPct) {
    severity = 'critical';
  } else if (
    over >= FORECAST_RULES.warningOverrunPct ||
    drivers.some((driver) => driver.kind === 'schedule' || driver.kind === 'overdue')
  ) {
    severity = 'warning';
  } else if (over > 0 || drivers.length > 0) {
    severity = 'watch';
  }

  return {
    method,
    spent,
    budget,
    forecast,
    overrun,
    overrunPct,
    progressPct,
    elapsedPct,
    severity,
    drivers,
  };
}

/** The three cost lines that rose most, fortnight on fortnight. */
function spendTrends(
  spend: ForecastInput['spend'],
  today: IsoDate,
  budget: bigint | null,
): ForecastDriver[] {
  const recentFrom = addDays(today, -(FORECAST_RULES.trendDays - 1));
  const previousFrom = addDays(recentFrom, -FORECAST_RULES.trendDays);

  const lines = new Map<string, { recent: bigint; previous: bigint }>();
  let recentTotal = 0n;
  let previousTotal = 0n;
  for (const row of spend) {
    if (row.date > today || row.date < previousFrom) continue;
    const entry = lines.get(row.line) ?? { recent: 0n, previous: 0n };
    if (row.date >= recentFrom) {
      entry.recent += row.amount;
      recentTotal += row.amount;
    } else {
      entry.previous += row.amount;
      previousTotal += row.amount;
    }
    lines.set(row.line, entry);
  }
  // A site with no spending in the earlier fortnight has no trend yet: every line on it is "new",
  // and saying so would bury the one reason that matters under several that mean nothing.
  if (previousTotal === 0n) return [];
  // Without a budget there is no scale to judge by, and every qualifying line is shown.
  const material =
    budget !== null && budget > 0n ? (budget * BigInt(FORECAST_RULES.trendBudgetPct)) / 100n : 0n;

  return [...lines.entries()]
    .map(([line, { recent, previous }]) => ({
      line,
      recent,
      previous,
      changePct: previous > 0n ? pct(recent - previous, previous) : null,
    }))
    .filter(({ recent, previous }) => recent - previous >= material)
    .filter(({ recent, previous, changePct }) =>
      changePct === null
        ? // A line that is new this fortnight matters only if it is a real share of the spend.
          recentTotal > 0n && recent * 10n >= recentTotal
        : changePct >= FORECAST_RULES.trendPct && recent > previous,
    )
    .sort((a, b) => Number(b.recent - b.previous - (a.recent - a.previous)))
    .slice(0, 3)
    .map((trend) => ({ kind: 'spend_trend' as const, ...trend }));
}

/**
 * The card's sentence, built only from the forecast's own figures.
 *
 * This is what the owner reads when no language model is configured, and the reference the
 * model's rewording is checked against when one is.
 */
export function explainForecast(forecast: SiteForecast, format: MoneyFormat): string {
  const money = (value: bigint) => formatMoneyCompact(value, format);
  const parts: string[] = [];

  if (forecast.forecast !== null && forecast.budget !== null && forecast.overrunPct !== null) {
    const verdict =
      forecast.overrunPct > 0
        ? `${forecast.overrunPct}% over`
        : forecast.overrunPct < 0
          ? `${-forecast.overrunPct}% under`
          : 'on budget';
    parts.push(
      `On course to finish at ${money(forecast.forecast)} against a ${money(forecast.budget)} budget (${verdict}).`,
    );
  } else if (forecast.forecast !== null) {
    parts.push(
      `On course to finish at ${money(forecast.forecast)}; no budget is set to compare it with.`,
    );
  } else if (forecast.budget !== null) {
    parts.push(
      `${money(forecast.spent)} spent of a ${money(forecast.budget)} budget (${pct(forecast.spent, forecast.budget)}%).`,
    );
  } else {
    parts.push(`${money(forecast.spent)} spent so far; no budget is set.`);
  }

  for (const driver of forecast.drivers.slice(0, 2)) {
    parts.push(describeDriver(driver, format));
  }
  return parts.join(' ');
}

export function describeDriver(driver: ForecastDriver, format: MoneyFormat): string {
  const money = (value: bigint) => formatMoneyCompact(value, format);
  switch (driver.kind) {
    case 'spend_trend':
      return driver.changePct === null
        ? `${driver.line} is new: ${money(driver.recent)} in the last two weeks.`
        : `${driver.line} is up ${driver.changePct}% on the two weeks before (${money(driver.recent)} against ${money(driver.previous)}).`;
    case 'material':
      return driver.progressPct === null
        ? `${driver.name} has used ${driver.usedPct}% of its estimate.`
        : `${driver.name} has used ${driver.usedPct}% of its estimate at ${driver.progressPct}% progress.`;
    case 'schedule':
      return `Work is ${driver.progressPct}% done with ${driver.elapsedPct}% of the time gone.`;
    case 'overdue':
      return `The target end date passed ${driver.daysPast} days ago.`;
  }
}
