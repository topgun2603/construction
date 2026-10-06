import { describe, expect, it } from 'vitest';
import {
  excelColumnWidth,
  excelDateValue,
  excelFileName,
  excelMoneyFormat,
  excelMoneyValue,
  excelNormaliseHeader,
  excelSheetName,
  excelWallClock,
  importCoerceBoolean,
  importCoerceDate,
  importCoerceDecimal,
  importCoerceEmail,
  importCoerceEnum,
  importCoerceInteger,
  importCoerceMoney,
  importCoercePhone,
  importCoerceText,
  importFindHeaderRow,
  importMatchColumns,
  type ImportFieldSpec,
} from './excel';

const fields: ImportFieldSpec[] = [
  { key: 'name', label: 'Name', type: 'text', aliases: ['worker', 'பெயர்', 'الاسم'] },
  { key: 'phone', label: 'Phone', type: 'phone', aliases: ['mobile', 'الهاتف'] },
  { key: 'daily_wage', label: 'Daily wage', type: 'money', aliases: ['wage'] },
];

describe('export values', () => {
  it('turns minor units into the number a cell holds', () => {
    expect(excelMoneyValue(125050n, 2)).toBe(1250.5);
    expect(excelMoneyValue('-99', 2)).toBe(-0.99);
    expect(excelMoneyValue('1234567', 3)).toBe(1234.567);
    expect(excelMoneyValue(500n, 0)).toBe(500);
    expect(excelMoneyValue(null, 2)).toBeNull();
  });

  it('formats money with the currency code and its own decimals', () => {
    expect(excelMoneyFormat('INR', 2)).toBe('[$INR] #,##0.00;-[$INR] #,##0.00');
    expect(excelMoneyFormat('KWD', 3)).toContain('#,##0.000');
    expect(excelMoneyFormat('JPY', 0)).toBe('[$JPY] #,##0;-[$JPY] #,##0');
  });

  it('writes an instant as the company clock read it', () => {
    // 04:00 UTC is 08:00 in Dubai and 09:30 in India.
    expect(excelWallClock('2026-10-06T04:00:00Z', 'Asia/Dubai').toISOString()).toBe('2026-10-06T08:00:00.000Z');
    expect(excelWallClock(new Date('2026-10-06T04:00:00Z'), 'Asia/Kolkata').toISOString()).toBe('2026-10-06T09:30:00.000Z');
    // Late evening UTC is already tomorrow in India.
    expect(excelWallClock('2026-10-06T20:00:00Z', 'Asia/Kolkata').toISOString().slice(0, 10)).toBe('2026-10-07');
  });

  it('writes a calendar date as that day with no time', () => {
    expect(excelDateValue('2026-10-06')?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(excelDateValue(null)).toBeNull();
  });

  it('names sheets and files safely', () => {
    expect(excelSheetName('Snags / punch list: [Block A]')).toBe('Snags punch list Block A');
    expect(excelSheetName('x'.repeat(40))).toHaveLength(31);
    expect(excelFileName('Purchase orders', 'xlsx', '2026-10-06')).toBe('purchase-orders-2026-10-06.xlsx');
  });

  it('sizes columns from the header and type', () => {
    expect(excelColumnWidth({ key: 'a', header: 'Amount', type: 'money' })).toBe(16);
    expect(excelColumnWidth({ key: 'a', header: 'A very long column header indeed', type: 'integer' })).toBe(34);
    expect(excelColumnWidth({ key: 'a', header: 'A', type: 'text', width: 40 })).toBe(40);
  });
});

describe('header matching', () => {
  it('normalises case, spacing, punctuation, stars and brackets', () => {
    expect(excelNormaliseHeader('  Daily Wage (₹) *')).toBe('dailywage');
    expect(excelNormaliseHeader('daily_wage')).toBe('dailywage');
    expect(excelNormaliseHeader('\uFEFFName')).toBe('name');
    expect(excelNormaliseHeader('பெயர்')).toBe('பெயர்');
  });

  it('matches by key, label and alias, including Tamil and Arabic', () => {
    expect(importMatchColumns(['Worker', 'Mobile', 'Wage'], fields)).toEqual({ name: 0, phone: 1, daily_wage: 2 });
    expect(importMatchColumns(['الاسم', 'الهاتف'], fields)).toEqual({ name: 0, phone: 1 });
    expect(importMatchColumns(['பெயர்', 'daily_wage'], fields)).toEqual({ name: 0, daily_wage: 1 });
  });

  it('uses each column once and leaves unmatched fields out', () => {
    expect(importMatchColumns(['Name', 'Name', 'Notes'], fields)).toEqual({ name: 0 });
  });

  it('finds the header row under a title', () => {
    const rows = [['Workers — Harbour Point'], [], ['Name', 'Phone', 'Daily wage'], ['Ravi', '9876543210', '800']];
    expect(importFindHeaderRow(rows, fields)).toBe(2);
    expect(importFindHeaderRow([['a', 'b']], fields)).toBe(-1);
  });
});

describe('reading cells', () => {
  it('reads text, trimming and refusing what is too long', () => {
    expect(importCoerceText('  Ravi ')).toEqual({ ok: true, value: 'Ravi' });
    expect(importCoerceText(12.5)).toEqual({ ok: true, value: '12.5' });
    expect(importCoerceText(0.1 + 0.2)).toEqual({ ok: true, value: '0.3' });
    expect(importCoerceText('')).toEqual({ ok: true, value: null });
    expect(importCoerceText('abcdef', 3).ok).toBe(false);
  });

  it('reads money the way people type it', () => {
    expect(importCoerceMoney('1,25,000.50', 2)).toEqual({ ok: true, value: '12500050' });
    expect(importCoerceMoney('1,250,000', 2)).toEqual({ ok: true, value: '125000000' });
    expect(importCoerceMoney('₹ 850', 2)).toEqual({ ok: true, value: '85000' });
    expect(importCoerceMoney('Rs. 850', 2)).toEqual({ ok: true, value: '85000' });
    expect(importCoerceMoney('AED 1,250.75', 2)).toEqual({ ok: true, value: '125075' });
    expect(importCoerceMoney('1250 AED', 2)).toEqual({ ok: true, value: '125000' });
    expect(importCoerceMoney('(1,250.00)', 2)).toEqual({ ok: true, value: '-125000' });
    expect(importCoerceMoney('١٬٢٥٠٫٥', 2)).toEqual({ ok: true, value: '125050' });
    expect(importCoerceMoney(850.5, 2)).toEqual({ ok: true, value: '85050' });
    expect(importCoerceMoney(12.345, 3)).toEqual({ ok: true, value: '12345' });
    expect(importCoerceMoney(null, 2)).toEqual({ ok: true, value: null });
  });

  it('refuses money it cannot read rather than guessing', () => {
    expect(importCoerceMoney('12.345', 2).ok).toBe(false);
    expect(importCoerceMoney('about 500', 2).ok).toBe(false);
    expect(importCoerceMoney('12.5', 0).ok).toBe(false);
    expect(importCoerceMoney(true, 2).ok).toBe(false);
  });

  it('reads dates day first, from cells, serials and text', () => {
    const tz = 'Asia/Kolkata';
    expect(importCoerceDate(new Date(Date.UTC(2026, 9, 6)), tz)).toEqual({ ok: true, value: '2026-10-06' });
    expect(importCoerceDate(46301, tz)).toEqual({ ok: true, value: '2026-10-06' });
    expect(importCoerceDate('05/06/2026', tz)).toEqual({ ok: true, value: '2026-06-05' });
    expect(importCoerceDate('2026-10-06', tz)).toEqual({ ok: true, value: '2026-10-06' });
    expect(importCoerceDate('2026-10-06T00:00:00', tz)).toEqual({ ok: true, value: '2026-10-06' });
    expect(importCoerceDate('6 Oct 2026', tz)).toEqual({ ok: true, value: '2026-10-06' });
    expect(importCoerceDate('31/02/2026', tz).ok).toBe(false);
    expect(importCoerceDate('soon', tz).ok).toBe(false);
  });

  it('reads today in the company time zone', () => {
    // 20:00 UTC on the 6th is already the 7th in India and still the 6th in New York.
    const now = new Date('2026-10-06T20:00:00Z');
    expect(importCoerceDate('today', 'Asia/Kolkata', now)).toEqual({ ok: true, value: '2026-10-07' });
    expect(importCoerceDate('Today', 'America/New_York', now)).toEqual({ ok: true, value: '2026-10-06' });
    expect(importCoerceDate('yesterday', 'Asia/Kolkata', now)).toEqual({ ok: true, value: '2026-10-06' });
  });

  it("reads phone numbers in the company's country", () => {
    expect(importCoercePhone('98765 43210', 'IN')).toEqual({ ok: true, value: '919876543210' });
    expect(importCoercePhone(9876543210, 'IN')).toEqual({ ok: true, value: '919876543210' });
    expect(importCoercePhone('050 123 4567', 'AE')).toEqual({ ok: true, value: '971501234567' });
    expect(importCoercePhone('+971 50 123 4567', 'IN')).toEqual({ ok: true, value: '971501234567' });
    expect(importCoercePhone('050 123 4567', 'IN').ok).toBe(false);
    expect(importCoercePhone('', 'IN')).toEqual({ ok: true, value: null });
  });

  it('reads whole numbers and decimals', () => {
    expect(importCoerceInteger('2,021')).toEqual({ ok: true, value: 2021 });
    expect(importCoerceInteger(30)).toEqual({ ok: true, value: 30 });
    expect(importCoerceInteger('30.5').ok).toBe(false);
    expect(importCoerceDecimal('120.500', 3)).toEqual({ ok: true, value: '120.5' });
    expect(importCoerceDecimal(7.25, 1).ok).toBe(false);
    expect(importCoerceDecimal('-1', 2).ok).toBe(false);
  });

  it('reads yes and no in three languages', () => {
    expect(importCoerceBoolean('Yes')).toEqual({ ok: true, value: true });
    expect(importCoerceBoolean('n')).toEqual({ ok: true, value: false });
    expect(importCoerceBoolean('نعم')).toEqual({ ok: true, value: true });
    expect(importCoerceBoolean('இல்லை')).toEqual({ ok: true, value: false });
    expect(importCoerceBoolean(true)).toEqual({ ok: true, value: true });
    expect(importCoerceBoolean('maybe').ok).toBe(false);
  });

  it('reads an option by value, label or alias', () => {
    const levels = ['unskilled', 'semi', 'skilled'] as const;
    const aliases = { semi: ['semi skilled'] };
    expect(importCoerceEnum('Semi-skilled', levels, aliases)).toEqual({ ok: true, value: 'semi' });
    expect(importCoerceEnum('SKILLED', levels, aliases)).toEqual({ ok: true, value: 'skilled' });
    expect(importCoerceEnum('on hold', ['planning', 'on_hold'])).toEqual({ ok: true, value: 'on_hold' });
    const wrong = importCoerceEnum('expert', levels, aliases);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain('unskilled, semi, skilled');
  });

  it('reads an email address', () => {
    expect(importCoerceEmail(' Sales@Balaji.Example ')).toEqual({ ok: true, value: 'sales@balaji.example' });
    expect(importCoerceEmail('not an email').ok).toBe(false);
  });
});
