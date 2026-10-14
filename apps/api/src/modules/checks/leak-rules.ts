import {
  addDays,
  equipmentFuelOutliers,
  equipmentLitresFromHundredths,
  type EquipmentFuelDay,
  type IsoDate,
} from '@sitebook/shared';

/**
 * Leakage and fraud checks (roadmap: AI agent 3).
 *
 * Plain rules over the records a company already keeps — no model, because a flag that accuses a
 * supervisor of padding a roll call has to be explainable line by line. Each rule returns findings
 * with a stable `subjectKey`, so the same finding is never raised twice and a dismissed one never
 * comes back (the table is unique on kind + subject).
 *
 * The person deciding sees the facts and taps confirm or dismiss; nothing here changes a record.
 */

export type CheckKind =
  | 'double_booked'
  | 'never_off'
  | 'headcount_gap'
  | 'duplicate_expense'
  | 'unusual_expense'
  | 'unidentified_paid'
  | 'fuel_outlier';

export interface Finding {
  kind: CheckKind;
  subjectKey: string;
  projectId: string | null;
  severity: 'high' | 'medium';
  /** One sentence an owner can act on, without amounts — those are formatted by the caller. */
  title: string;
  /** The records behind the finding, so the screen can link to them. */
  details: Record<string, unknown>;
}

export const CHECK_RULES = Object.freeze({
  lookbackDays: 30,
  neverOffDays: 21,
  headcountGapMin: 3,
  headcountGapPct: 25,
  duplicateWindowDays: 3,
  unusualMultiple: 3n,
  unusualMinSamples: 5,
});

// --- attendance -------------------------------------------------------------------------------

export interface AttendanceRow {
  workerId: string;
  workerName: string;
  projectId: string;
  projectName: string;
  date: IsoDate;
  status: string;
}

const WORKED = new Set(['present', 'half_day']);

/**
 * The same worker paid for more than one day's work on one day, across sites.
 *
 * Half a day on each of two sites is ordinary and is not flagged; a full day on one and any time on
 * another is. The roll call already refuses this as it is entered (WORKER_OVERBOOKED), so what
 * reaches here came another way — an offline phone syncing late, a backdated edit — and is exactly
 * what nobody was looking at.
 */
export function doubleBooked(rows: AttendanceRow[]): Finding[] {
  const byWorkerDay = new Map<string, AttendanceRow[]>();
  for (const row of rows) {
    if (!WORKED.has(row.status)) continue;
    const key = `${row.workerId}:${row.date}`;
    byWorkerDay.set(key, [...(byWorkerDay.get(key) ?? []), row]);
  }
  return [...byWorkerDay.entries()]
    .filter(([, day]) => day.reduce((sum, d) => sum + (d.status === 'present' ? 2 : 1), 0) > 2)
    .map(([key, day]) => ({
      kind: 'double_booked' as const,
      subjectKey: key,
      projectId: day[0]!.projectId,
      severity: 'high' as const,
      title: `${day[0]!.workerName} is marked as working more than one full day on ${day[0]!.date}, across ${day.length} sites: ${day
        .map((d) => d.projectName)
        .join(', ')}.`,
      details: {
        worker_id: day[0]!.workerId,
        date: day[0]!.date,
        project_ids: day.map((d) => d.projectId),
      },
    }));
}

/**
 * A worker present every single day for three weeks or more. Real crews take days off; a name that
 * never does is the classic padded roll.
 */
export function neverOff(rows: AttendanceRow[], today: IsoDate): Finding[] {
  const days = new Map<string, { name: string; projectId: string; dates: Set<string> }>();
  for (const row of rows) {
    if (!WORKED.has(row.status)) continue;
    const entry = days.get(row.workerId) ?? {
      name: row.workerName,
      projectId: row.projectId,
      dates: new Set(),
    };
    entry.dates.add(row.date);
    days.set(row.workerId, entry);
  }

  const findings: Finding[] = [];
  for (const [workerId, { name, projectId, dates }] of days) {
    // The longest unbroken run ending on or before today.
    let best = { length: 0, start: '' };
    let run = { length: 0, start: '' };
    for (
      let date = addDays(today, -CHECK_RULES.lookbackDays);
      date <= today;
      date = addDays(date, 1)
    ) {
      if (dates.has(date)) {
        run =
          run.length === 0
            ? { length: 1, start: date }
            : { length: run.length + 1, start: run.start };
        if (run.length > best.length) best = run;
      } else {
        run = { length: 0, start: '' };
      }
    }
    if (best.length >= CHECK_RULES.neverOffDays) {
      findings.push({
        kind: 'never_off',
        // Keyed by where the run began, so a run that keeps growing stays one finding.
        subjectKey: `${workerId}:${best.start}`,
        projectId,
        severity: 'medium',
        title: `${name} has been marked present ${best.length} days in a row without a day off, since ${best.start}.`,
        details: { worker_id: workerId, from: best.start, days: best.length },
      });
    }
  }
  return findings;
}

export interface ReportedManpower {
  projectId: string;
  projectName: string;
  date: IsoDate;
  /** Total people the site report says were on site. */
  reported: number;
}

/** The roll call has noticeably more people than the site's own report for the same day. */
export function headcountGap(rows: AttendanceRow[], reports: ReportedManpower[]): Finding[] {
  const counted = new Map<string, number>();
  for (const row of rows) {
    if (!WORKED.has(row.status)) continue;
    const key = `${row.projectId}:${row.date}`;
    counted.set(key, (counted.get(key) ?? 0) + 1);
  }
  return reports
    .filter((report) => report.reported > 0)
    .flatMap((report) => {
      const rollCall = counted.get(`${report.projectId}:${report.date}`) ?? 0;
      const gap = rollCall - report.reported;
      if (
        gap < CHECK_RULES.headcountGapMin ||
        gap * 100 < report.reported * CHECK_RULES.headcountGapPct
      ) {
        return [];
      }
      return [
        {
          kind: 'headcount_gap' as const,
          subjectKey: `${report.projectId}:${report.date}`,
          projectId: report.projectId,
          severity: 'medium' as const,
          title: `${report.projectName} on ${report.date}: ${rollCall} on the roll call, but the site report says ${report.reported} were on site.`,
          details: { date: report.date, roll_call: rollCall, reported: report.reported },
        },
      ];
    });
}

// --- money --------------------------------------------------------------------------------

export interface ExpenseRow {
  id: string;
  projectId: string;
  projectName: string;
  amount: bigint;
  category: string;
  spentOn: IsoDate;
}

/** Same site, same category, same amount, within a few days: the same bill entered twice. */
export function duplicateExpenses(rows: ExpenseRow[]): Finding[] {
  const findings: Finding[] = [];
  const sorted = [...rows].sort(
    (a, b) => a.spentOn.localeCompare(b.spentOn) || a.id.localeCompare(b.id),
  );
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (b.spentOn > addDays(a.spentOn, CHECK_RULES.duplicateWindowDays)) break;
      if (a.projectId !== b.projectId || a.category !== b.category || a.amount !== b.amount)
        continue;
      findings.push({
        kind: 'duplicate_expense',
        subjectKey: [a.id, b.id].sort().join(':'),
        projectId: a.projectId,
        severity: 'high',
        title: `Two ${a.category} expenses for the same amount at ${a.projectName}, on ${a.spentOn} and ${b.spentOn}.`,
        details: { expense_ids: [a.id, b.id], amount: a.amount.toString() },
      });
    }
  }
  return findings;
}

/**
 * An expense several times the usual size for its category. "Usual" is the median of the
 * company's own earlier expenses in that category, so it adapts to each company's scale.
 */
export function unusualExpenses(recent: ExpenseRow[], history: ExpenseRow[]): Finding[] {
  const byCategory = new Map<string, bigint[]>();
  for (const row of history)
    byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row.amount]);

  return recent.flatMap((row) => {
    const amounts = byCategory.get(row.category) ?? [];
    if (amounts.length < CHECK_RULES.unusualMinSamples) return [];
    const median = medianOf(amounts);
    if (median <= 0n || row.amount < median * CHECK_RULES.unusualMultiple) return [];
    return [
      {
        kind: 'unusual_expense' as const,
        subjectKey: row.id,
        projectId: row.projectId,
        severity: 'medium' as const,
        title: `A ${row.category} expense at ${row.projectName} on ${row.spentOn} is ${Number(row.amount / median)}× the usual ${row.category} bill.`,
        details: { expense_id: row.id, amount: row.amount.toString(), usual: median.toString() },
      },
    ];
  });
}

function medianOf(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

// --- people ------------------------------------------------------------------------------

export interface PaidWorker {
  workerId: string;
  workerName: string;
  projectId: string | null;
  hasPhone: boolean;
  hasIdProof: boolean;
  hasPhoto: boolean;
}

/** Paid, but nothing on file that would prove the person exists: no phone, no ID, no photo. */
export function unidentifiedPaid(workers: PaidWorker[]): Finding[] {
  return workers
    .filter((worker) => !worker.hasPhone && !worker.hasIdProof && !worker.hasPhoto)
    .map((worker) => ({
      kind: 'unidentified_paid' as const,
      subjectKey: worker.workerId,
      projectId: worker.projectId,
      severity: 'medium' as const,
      title: `${worker.workerName} has been paid but has no phone number, ID proof or photo on file.`,
      details: { worker_id: worker.workerId },
    }));
}

// --- equipment ---------------------------------------------------------------------------

export interface FuelDayRow extends EquipmentFuelDay {
  machineLabel: string;
  projectName: string;
}

/**
 * A machine that drew far more diesel per hour on a day than it does on its other days (equipment,
 * roadmap Phase 2, module 10). The arithmetic is `equipmentFuelOutliers` in @sitebook/shared — the
 * same figures the equipment fuel report shows — so a flag here can always be found on that screen.
 */
export function fuelOutliers(days: FuelDayRow[]): Finding[] {
  const labels = new Map(days.map((day) => [`${day.equipmentId}:${day.date}`, day]));
  return equipmentFuelOutliers(days).map((day) => {
    const row = labels.get(`${day.equipmentId}:${day.date}`)!;
    return {
      kind: 'fuel_outlier' as const,
      subjectKey: `${day.equipmentId}:${day.date}`,
      projectId: day.projectId,
      severity: 'medium' as const,
      title: `${row.machineLabel} drew ${day.rate} L/h at ${row.projectName} on ${day.date}, ${day.abovePercent}% above its usual ${day.average} L/h.`,
      details: {
        equipment_id: day.equipmentId,
        date: day.date,
        litres: equipmentLitresFromHundredths(day.litresHundredths),
        hours: day.workedTenths / 10,
        rate: day.rate,
        usual: day.average,
      },
    };
  });
}
