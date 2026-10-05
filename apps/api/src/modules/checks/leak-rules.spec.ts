import { addDays } from '@sitebook/shared';
import {
  doubleBooked,
  duplicateExpenses,
  headcountGap,
  neverOff,
  unidentifiedPaid,
  unusualExpenses,
  type AttendanceRow,
  type ExpenseRow,
} from './leak-rules';

const TODAY = '2026-10-05';
const row = (over: Partial<AttendanceRow>): AttendanceRow => ({
  workerId: 'w1',
  workerName: 'Raju',
  projectId: 'p1',
  projectName: 'Lakeview',
  date: TODAY,
  status: 'present',
  ...over,
});
const expense = (over: Partial<ExpenseRow>): ExpenseRow => ({
  id: 'e1',
  projectId: 'p1',
  projectName: 'Lakeview',
  amount: 10_000n,
  category: 'fuel',
  spentOn: TODAY,
  ...over,
});

describe('leak rules', () => {
  it('flags one worker present on two sites the same day, not on two different days', () => {
    const findings = doubleBooked([
      row({}),
      row({ projectId: 'p2', projectName: 'Green Acres' }),
      row({ date: addDays(TODAY, -1), projectId: 'p2' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain('Lakeview, Green Acres');
    // An absence on the second site is not a double booking, and neither are two half days.
    expect(doubleBooked([row({}), row({ projectId: 'p2', status: 'absent' })])).toEqual([]);
    expect(
      doubleBooked([row({ status: 'half_day' }), row({ projectId: 'p2', status: 'half_day' })]),
    ).toEqual([]);
    // A full day and a half day is more than a day.
    expect(doubleBooked([row({}), row({ projectId: 'p2', status: 'half_day' })])).toHaveLength(1);
  });

  it('flags three weeks without a day off, and keeps one finding as the run grows', () => {
    const rows = Array.from({ length: 22 }, (_, i) => row({ date: addDays(TODAY, -i) }));
    const findings = neverOff(rows, TODAY);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.subjectKey).toBe(`w1:${addDays(TODAY, -21)}`);
    // A Sunday off breaks it.
    expect(
      neverOff(
        rows.filter((_, i) => i !== 7),
        TODAY,
      ),
    ).toEqual([]);
  });

  it('flags a roll call well above what the site report says', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ workerId: `w${i}` }));
    const report = { projectId: 'p1', projectName: 'Lakeview', date: TODAY };
    expect(headcountGap(rows, [{ ...report, reported: 8 }])).toHaveLength(1);
    // A gap of one or two is ordinary miscounting.
    expect(headcountGap(rows, [{ ...report, reported: 10 }])).toEqual([]);
  });

  it('flags the same bill entered twice within a few days', () => {
    const findings = duplicateExpenses([
      expense({ id: 'a' }),
      expense({ id: 'b', spentOn: addDays(TODAY, 2) }),
      expense({ id: 'c', spentOn: addDays(TODAY, 9) }),
      expense({ id: 'd', category: 'transport' }),
    ]);
    expect(findings.map((f) => f.subjectKey)).toEqual(['a:b']);
  });

  it('flags an expense several times the usual for its category, once there is a usual', () => {
    const history = [8_000n, 9_000n, 10_000n, 11_000n, 12_000n].map((amount, i) =>
      expense({ id: `h${i}`, amount }),
    );
    expect(unusualExpenses([expense({ id: 'big', amount: 40_000n })], history)).toHaveLength(1);
    expect(unusualExpenses([expense({ id: 'ok', amount: 20_000n })], history)).toEqual([]);
    expect(unusualExpenses([expense({ id: 'big', amount: 40_000n })], history.slice(0, 3))).toEqual(
      [],
    );
  });

  it('flags a paid worker with nothing on file to prove they exist', () => {
    const base = { workerId: 'w1', workerName: 'Raju', projectId: 'p1' };
    expect(
      unidentifiedPaid([{ ...base, hasPhone: false, hasIdProof: false, hasPhoto: false }]),
    ).toHaveLength(1);
    expect(
      unidentifiedPaid([{ ...base, hasPhone: true, hasIdProof: false, hasPhoto: false }]),
    ).toEqual([]);
  });
});
