import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { explainForecast, forecastSite, type ForecastInput } from './forecast';
import { INDIA_LOCALE } from './locale';

const TODAY = '2026-10-05';
const AED = { currency: 'AED', locale: 'en-AE' };

/** `amount` every day from `from` to `to` on one line. */
function daily(line: string, amount: bigint, from: string, to: string) {
  const rows: ForecastInput['spend'][number][] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) rows.push({ date, line, amount });
  return rows;
}

const base = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  today: TODAY,
  budget: null,
  startDate: null,
  targetEndDate: null,
  spend: [],
  milestones: { total: 0, done: 0 },
  materials: [],
  ...over,
});

describe('forecastSite', () => {
  it('projects from milestones when there are enough of them', () => {
    const result = forecastSite(
      base({
        budget: 400_000_00n,
        spend: [{ date: TODAY, line: 'Labour · Mason', amount: 180_000_00n }],
        milestones: { total: 10, done: 4 },
      }),
    );
    expect(result.method).toBe('progress');
    // 40% done for 1.8 lakh → 4.5 lakh at the end, 12.5% over a 4 lakh budget.
    expect(result.forecast).toBe(450_000_00n);
    expect(result.overrunPct).toBe(12);
    expect(result.severity).toBe('warning');
  });

  it('projects from the last four weeks of spend when there are no milestones', () => {
    const result = forecastSite(
      base({
        budget: 1_000_000n,
        startDate: '2026-09-01',
        targetEndDate: '2026-11-03',
        // 1,000 a day since 8 September: 28 days in the window, 29 days left.
        spend: daily('Labour · Helper', 1_000n, '2026-09-08', TODAY),
      }),
    );
    expect(result.method).toBe('burn_rate');
    expect(result.forecast).toBe(28_000n + 29_000n);
    expect(result.severity).toBe('ok');
  });

  it('says only what it knows when there is nothing to project from', () => {
    const result = forecastSite(
      base({ budget: 500n, spend: [{ date: TODAY, line: 'x', amount: 100n }] }),
    );
    expect(result.method).toBe('spend_only');
    expect(result.forecast).toBeNull();
    expect(explainForecast(result, INDIA_LOCALE)).toMatch(/spent of a .* budget \(20%\)/);
  });

  it('is critical once the budget is already spent', () => {
    const result = forecastSite(
      base({ budget: 100n, spend: [{ date: TODAY, line: 'x', amount: 150n }] }),
    );
    expect(result.severity).toBe('critical');
  });

  it('names the cost line that rose, fortnight on fortnight', () => {
    const result = forecastSite(
      base({
        spend: [
          ...daily('Labour · Mason', 1_000n, '2026-09-08', '2026-09-21'),
          ...daily('Labour · Mason', 1_180n, '2026-09-22', TODAY),
          ...daily('Labour · Helper', 500n, '2026-09-08', TODAY),
        ],
      }),
    );
    const trend = result.drivers.find((driver) => driver.kind === 'spend_trend');
    expect(trend).toMatchObject({ line: 'Labour · Mason', changePct: 18 });
    // A flat line is not a driver.
    expect(
      result.drivers.some((d) => d.kind === 'spend_trend' && d.line === 'Labour · Helper'),
    ).toBe(false);
    expect(result.severity).toBe('watch');
  });

  it('calls nothing a trend on a site too young to have one', () => {
    const result = forecastSite(
      base({
        spend: [
          ...daily('Expense · Transport', 3_000n, '2026-09-28', TODAY),
          ...daily('Expense · Repairs', 2_000n, '2026-09-28', TODAY),
        ],
      }),
    );
    expect(result.drivers).toEqual([]);
    expect(result.severity).toBe('ok');
  });

  it('names a genuinely new cost line on a site with history', () => {
    const result = forecastSite(
      base({
        spend: [
          ...daily('Labour · Mason', 1_000n, '2026-09-08', TODAY),
          ...daily('Expense · Crane hire', 4_000n, '2026-09-28', TODAY),
        ],
      }),
    );
    expect(result.drivers).toContainEqual(
      expect.objectContaining({
        kind: 'spend_trend',
        line: 'Expense · Crane hire',
        changePct: null,
      }),
    );
  });

  it('leaves out a rise too small to matter against the budget', () => {
    const spend = [
      ...daily('Labour · Mason', 1_000n, '2026-09-08', TODAY),
      ...daily('Expense · Safety', 400n, '2026-09-28', TODAY),
    ];
    // 3,200 of new safety spend is 0.3% of a 1,000,000 budget: not worth an owner's attention.
    expect(forecastSite(base({ budget: 1_000_000n, spend })).drivers).toEqual([]);
    // Against a 100,000 budget it is 3%, and it is named.
    expect(forecastSite(base({ budget: 100_000n, spend })).drivers).toHaveLength(1);
  });

  it('flags materials used faster than the work, and work behind the calendar', () => {
    const result = forecastSite(
      base({
        startDate: '2026-07-01',
        targetEndDate: '2026-12-31',
        milestones: { total: 10, done: 3 },
        spend: [{ date: TODAY, line: 'x', amount: 1n }],
        materials: [{ name: 'Cement', unit: 'bag', estimated: 1_000_000n, consumed: 600_000n }],
      }),
    );
    expect(result.drivers).toContainEqual({
      kind: 'material',
      name: 'Cement',
      unit: 'bag',
      usedPct: 60,
      progressPct: 30,
    });
    expect(result.drivers).toContainEqual({ kind: 'schedule', progressPct: 30, elapsedPct: 52 });
    expect(result.severity).toBe('warning');
  });

  it('notices a site past its end date', () => {
    const result = forecastSite(
      base({
        startDate: '2026-06-01',
        targetEndDate: '2026-09-30',
        spend: [{ date: TODAY, line: 'x', amount: 1n }],
      }),
    );
    expect(result.drivers).toContainEqual({ kind: 'overdue', daysPast: 5 });
  });
});

describe('explainForecast', () => {
  it('writes the sentence in the company’s currency', () => {
    const result = forecastSite(
      base({
        budget: 4_200_000_00n,
        spend: [{ date: TODAY, line: 'Labour · Mason', amount: 2_300_000_00n }],
        milestones: { total: 10, done: 5 },
      }),
    );
    const sentence = explainForecast(result, AED);
    expect(sentence).toContain('AED');
    expect(sentence).toMatch(/9% over/);
    expect(sentence).not.toContain('₹');
  });
});
