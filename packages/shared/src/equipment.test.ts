import { describe, expect, it } from 'vitest';
import {
  equipmentChargeOut,
  equipmentCheckLog,
  equipmentCostLines,
  equipmentDayCharge,
  equipmentDaysOnSite,
  equipmentDocumentStanding,
  equipmentFromTenths,
  equipmentFuelOutliers,
  equipmentFuelRate,
  equipmentLitresFromHundredths,
  equipmentLitresToHundredths,
  equipmentMeterFits,
  equipmentMonthCharge,
  equipmentServiceDue,
  equipmentSuggestCode,
  equipmentSumLines,
  equipmentToTenths,
  equipmentUtilisation,
  type EquipmentCostInput,
  type EquipmentCostMachine,
} from './equipment';

const day = (worked: number, idle = 0, breakdown = 0) => ({
  workedTenths: worked,
  idleTenths: idle,
  breakdownTenths: breakdown,
});

describe('equipment units', () => {
  it('reads hours and meter readings in tenths', () => {
    expect(equipmentToTenths('7.5')).toBe(75);
    expect(equipmentToTenths('1250')).toBe(12500);
    expect(equipmentFromTenths(75)).toBe('7.5');
    expect(equipmentFromTenths(80)).toBe('8');
    expect(() => equipmentToTenths('7.55')).toThrow();
    expect(() => equipmentToTenths('-1')).toThrow();
  });

  it('reads litres in hundredths', () => {
    expect(equipmentLitresToHundredths('120.25')).toBe(12025);
    expect(equipmentLitresToHundredths('40.5')).toBe(4050);
    expect(equipmentLitresFromHundredths(4000)).toBe('40');
    expect(equipmentLitresFromHundredths(4050)).toBe('40.5');
  });

  it('suggests a code from the category', () => {
    expect(equipmentSuggestCode('backhoe', 7)).toBe('BH-007');
  });
});

describe('equipmentCheckLog', () => {
  it('takes the hours from an hour meter', () => {
    const result = equipmentCheckLog({
      meterType: 'hours',
      openingTenths: 12000,
      closingTenths: 12075,
      workedTenths: 999,
      idleTenths: 10,
      breakdownTenths: 0,
    });
    expect(result).toEqual({ ok: true, workedTenths: 75, idleTenths: 10, breakdownTenths: 0, distanceTenths: null });
  });

  it('refuses a closing reading below the opening one', () => {
    const result = equipmentCheckLog({
      meterType: 'hours',
      openingTenths: 12000,
      closingTenths: 11990,
      workedTenths: null,
      idleTenths: 0,
      breakdownTenths: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors['closing_meter']).toMatch(/below/);
  });

  it('refuses more than 24 hours in a day', () => {
    const tooMany = equipmentCheckLog({
      meterType: 'hours',
      openingTenths: 0,
      closingTenths: 250,
      workedTenths: null,
      idleTenths: 0,
      breakdownTenths: 0,
    });
    expect(tooMany.ok).toBe(false);
    const sum = equipmentCheckLog({
      meterType: 'none',
      openingTenths: null,
      closingTenths: null,
      workedTenths: 200,
      idleTenths: 30,
      breakdownTenths: 20,
    });
    expect(sum.ok).toBe(false);
    if (!sum.ok) expect(sum.errors['idle_hours']).toBeDefined();
  });

  it('wants typed hours and gives distance for a km meter', () => {
    expect(
      equipmentCheckLog({
        meterType: 'km',
        openingTenths: 1000,
        closingTenths: 1500,
        workedTenths: null,
        idleTenths: 0,
        breakdownTenths: 0,
      }).ok,
    ).toBe(false);
    expect(
      equipmentCheckLog({
        meterType: 'km',
        openingTenths: 1000,
        closingTenths: 1500,
        workedTenths: 60,
        idleTenths: 0,
        breakdownTenths: 0,
      }),
    ).toMatchObject({ ok: true, workedTenths: 60, distanceTenths: 500 });
  });

  it('refuses readings that overlap the days either side', () => {
    expect(equipmentMeterFits({ openingTenths: 100, closingTenths: 180 }, { closingTenths: 100 }, { openingTenths: 180 })).toEqual({
      ok: true,
    });
    expect(equipmentMeterFits({ openingTenths: 95, closingTenths: 180 }, { closingTenths: 100 }, null)).toMatchObject({
      ok: false,
      field: 'opening_meter',
    });
    expect(equipmentMeterFits({ openingTenths: 100, closingTenths: 190 }, null, { openingTenths: 180 })).toMatchObject({
      ok: false,
      field: 'closing_meter',
    });
  });
});

describe('hire charges', () => {
  const hourly = { basis: 'hour' as const, rate: 120000n, minHoursTenths: 80 };

  it('charges the hours worked above the minimum', () => {
    expect(equipmentDayCharge(hourly, day(95))).toEqual({ amount: 1140000n, chargeableTenths: 95, topUpTenths: 0 });
  });

  it('tops a short day up to the minimum hours', () => {
    expect(equipmentDayCharge(hourly, day(50, 30))).toEqual({ amount: 960000n, chargeableTenths: 80, topUpTenths: 30 });
  });

  it('does not charge the vendor’s breakdown towards the minimum', () => {
    // 3 h worked, 4 h broken down: the minimum shrinks to 4 h.
    expect(equipmentDayCharge(hourly, day(30, 0, 40))).toEqual({ amount: 480000n, chargeableTenths: 40, topUpTenths: 10 });
    expect(equipmentDayCharge(hourly, day(0, 0, 100)).amount).toBe(0n);
  });

  it('charges a day rate for a day the machine was available', () => {
    const daily = { basis: 'day' as const, rate: 900000n, minHoursTenths: null };
    expect(equipmentDayCharge(daily, day(0, 80)).amount).toBe(900000n);
    expect(equipmentDayCharge(daily, day(0, 0, 80)).amount).toBe(0n);
  });

  it('prorates a monthly hire and charges extra hours at the monthly hourly rate', () => {
    // ₹1,80,000 for 200 h a month; 15 of 30 days on hire covers 100 h; 130 h worked → 30 extra at ₹900.
    const charge = equipmentMonthCharge({
      rate: 18000000n,
      minHoursTenths: 2000,
      onHireDays: 15,
      daysInMonth: 30,
      workedTenths: 1300,
    });
    expect(charge).toEqual({ base: 9000000n, includedTenths: 1000, extraTenths: 300, extra: 2700000n, total: 11700000n });
    expect(
      equipmentMonthCharge({ rate: 18000000n, minHoursTenths: null, onHireDays: 30, daysInMonth: 30, workedTenths: 5000 }).total,
    ).toBe(18000000n);
  });

  it('charges an owned machine out by the hour or the day it worked', () => {
    expect(equipmentChargeOut({ basis: 'hour', rate: 80000n }, day(75))).toBe(600000n);
    expect(equipmentChargeOut({ basis: 'day', rate: 500000n }, day(10))).toBe(500000n);
    expect(equipmentChargeOut({ basis: 'day', rate: 500000n }, day(0, 80))).toBe(0n);
  });
});

describe('equipmentCostLines', () => {
  const hiredJcb: EquipmentCostMachine = {
    id: 'm1',
    code: 'BH-001',
    ownership: 'hired',
    hireBasis: 'hour',
    hireRate: 120000n,
    minHoursTenths: 80,
    operatorIncluded: false,
    operatorRatePerDay: 100000n,
    mobilisation: 500000n,
    chargeOutBasis: null,
    chargeOutRate: 0n,
  };
  const base: EquipmentCostInput = {
    machine: hiredJcb,
    allocations: [{ projectId: 'p1', costCodeId: 'cc1', from: '2026-10-01', to: null }],
    logs: [
      { date: '2026-10-01', projectId: 'p1', costCodeId: 'cc1', ...day(50) },
      { date: '2026-10-02', projectId: 'p1', costCodeId: 'cc1', ...day(90) },
    ],
    fuel: [
      { id: 'f1', date: '2026-10-01', projectId: 'p1', costCodeId: 'cc1', amount: 450000n, source: 'direct' },
      { id: 'f2', date: '2026-10-02', projectId: 'p1', costCodeId: 'cc1', amount: 450000n, source: 'expense' },
      { id: 'f3', date: '2026-10-02', projectId: 'p1', costCodeId: 'cc1', amount: 300000n, source: 'stock' },
    ],
    maintenance: [
      { id: 'r1', date: '2026-10-02', projectId: 'p1', costCodeId: null, cost: 200000n, expenseLinked: false },
      { id: 'r2', date: '2026-10-02', projectId: 'p1', costCodeId: null, cost: 700000n, expenseLinked: true },
      { id: 'r3', date: '2026-10-02', projectId: null, costCodeId: null, cost: 100000n, expenseLinked: false },
    ],
    booked: new Set(),
    window: { from: null, to: '2026-10-31' },
  };

  it('counts hire with the minimum, the operator, mobilisation, direct fuel and site repairs — nothing on an expense', () => {
    const lines = equipmentCostLines(base);
    const sum = equipmentSumLines(lines);
    // Hire: 8 h minimum (9,600) + 9 h (10,800); operator 2 × 1,000; mobilisation 5,000.
    expect(sum.byKind.hire).toBe(960000n + 1080000n);
    expect(sum.byKind.operator).toBe(200000n);
    expect(sum.byKind.mobilisation).toBe(500000n);
    // Counted: hire + operator + mobilisation + direct fuel 4,500 + site repair 2,000.
    expect(sum.counted).toBe(960000n + 1080000n + 200000n + 500000n + 450000n + 200000n);
    const uncounted = lines.filter((line) => !line.counted).map((line) => line.via).sort();
    expect(uncounted).toEqual(['expense', 'expense', 'no_site', 'stock']);
  });

  it('leaves a month booked as an expense to the expense', () => {
    const lines = equipmentCostLines({ ...base, booked: new Set(['p1:2026-10']) });
    const hireLines = lines.filter((line) => ['hire', 'operator', 'mobilisation'].includes(line.kind));
    expect(hireLines.every((line) => !line.counted && line.via === 'booked')).toBe(true);
  });

  it('keeps to the window', () => {
    const lines = equipmentCostLines({ ...base, window: { from: '2026-10-02', to: '2026-10-02' } });
    expect(lines.some((line) => line.date === '2026-10-01')).toBe(false);
  });

  it('works a monthly hire out per calendar month the machine was on site', () => {
    const crane: EquipmentCostMachine = { ...hiredJcb, hireBasis: 'month', hireRate: 18000000n, minHoursTenths: 2000, operatorRatePerDay: 0n, mobilisation: 0n };
    const lines = equipmentCostLines({
      ...base,
      machine: crane,
      allocations: [{ projectId: 'p1', costCodeId: 'cc1', from: '2026-09-16', to: '2026-10-15' }],
      logs: [{ date: '2026-09-20', projectId: 'p1', costCodeId: 'cc1', ...day(1300) }],
      fuel: [],
      maintenance: [],
    });
    expect(lines.map((line) => [line.month, line.onHireDays, line.amount])).toEqual([
      // September: 15 of 30 days, 100 h included, 130 h worked → 30 h extra.
      ['2026-09', 15, 11700000n],
      // October: 15 of 31 days.
      ['2026-10', 15, 8709677n],
    ]);
  });

  it('charges an owned machine out and counts it', () => {
    const owned: EquipmentCostMachine = {
      ...hiredJcb,
      ownership: 'owned',
      hireBasis: null,
      chargeOutBasis: 'hour',
      chargeOutRate: 80000n,
    };
    const lines = equipmentCostLines({ ...base, machine: owned, fuel: [], maintenance: [] });
    expect(lines.map((line) => [line.kind, line.amount])).toEqual([
      ['charge_out', 400000n],
      ['charge_out', 720000n],
    ]);
  });
});

describe('fuel', () => {
  it('works out litres per hour', () => {
    expect(equipmentFuelRate(4500, 75)).toBe(6);
    expect(equipmentFuelRate(4500, 0)).toBeNull();
  });

  it('flags a day well above the machine’s own average', () => {
    const days = [
      { date: '2026-10-01', litres: 4800, hours: 80 },
      { date: '2026-10-02', litres: 5000, hours: 80 },
      { date: '2026-10-03', litres: 4700, hours: 80 },
      { date: '2026-10-04', litres: 9000, hours: 80 },
      { date: '2026-10-05', litres: 3000, hours: 0 },
    ].map((d) => ({ equipmentId: 'm1', projectId: 'p1', date: d.date, litresHundredths: d.litres, workedTenths: d.hours }));
    const flagged = equipmentFuelOutliers(days);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ date: '2026-10-04', rate: 11.25, average: 6.04, abovePercent: 86 });
  });

  it('says nothing without enough days to judge by', () => {
    const days = [
      { date: '2026-10-01', litres: 4800 },
      { date: '2026-10-02', litres: 9000 },
    ].map((d) => ({ equipmentId: 'm1', projectId: 'p1', date: d.date, litresHundredths: d.litres, workedTenths: 80 }));
    expect(equipmentFuelOutliers(days)).toEqual([]);
  });
});

describe('equipmentServiceDue', () => {
  const plan = { meterType: 'hours' as const, intervalTenths: 2500, intervalDays: null, lastOn: null, today: '2026-10-06' };

  it('falls due by the hour meter', () => {
    expect(equipmentServiceDue({ ...plan, lastMeterTenths: 10000, currentMeterTenths: 11000 }).state).toBe('ok');
    expect(equipmentServiceDue({ ...plan, lastMeterTenths: 10000, currentMeterTenths: 12300 }).state).toBe('due_soon');
    expect(equipmentServiceDue({ ...plan, lastMeterTenths: 10000, currentMeterTenths: 12500 })).toMatchObject({
      state: 'due',
      nextMeterTenths: 12500,
      remainingTenths: 0,
    });
    expect(equipmentServiceDue({ ...plan, lastMeterTenths: 10000, currentMeterTenths: 12600 }).state).toBe('overdue');
  });

  it('falls due by the calendar, whichever comes first', () => {
    const result = equipmentServiceDue({
      ...plan,
      intervalDays: 90,
      lastOn: '2026-07-01',
      lastMeterTenths: 10000,
      currentMeterTenths: 10100,
    });
    expect(result).toMatchObject({ state: 'overdue', nextOn: '2026-09-29', remainingDays: -7 });
  });
});

describe('equipment documents and utilisation', () => {
  it('reads a document’s standing against today', () => {
    expect(equipmentDocumentStanding(null, '2026-10-06')).toBe('no_expiry');
    expect(equipmentDocumentStanding('2026-10-05', '2026-10-06')).toBe('expired');
    expect(equipmentDocumentStanding('2026-10-20', '2026-10-06')).toBe('expiring');
    expect(equipmentDocumentStanding('2027-01-01', '2026-10-06')).toBe('valid');
  });

  it('counts unlogged days on site as idle shifts', () => {
    const days = equipmentDaysOnSite([{ from: '2026-10-01', to: null }], { from: '2026-09-28', to: '2026-10-04' });
    expect(days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    const result = equipmentUtilisation(days, [
      { date: '2026-10-01', ...day(80) },
      { date: '2026-10-02', ...day(60, 0, 20) },
    ]);
    // Available: 8 + (8 − 2) + 8 + 8 = 30 h; worked 14 h.
    expect(result).toMatchObject({
      daysOnSite: 4,
      workedTenths: 140,
      breakdownTenths: 20,
      availableTenths: 300,
      idleTenths: 160,
      utilisationPercent: 47,
      breakdownPercent: 6,
    });
  });
});
