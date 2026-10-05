import { describe, expect, it } from 'vitest';
import { buildSif, missingWpsDetails } from './wps';

const employee = {
  personId: '10012345678901',
  agentCode: '803320101',
  account: 'AE070331234567890123456',
  payStart: '2026-10-01',
  payEnd: '2026-10-31',
  daysInPeriod: 31,
  fixed: 285_000n,
  variable: 16_000n,
  leaveDays: '1.5',
};

describe('buildSif', () => {
  const sif = buildSif({
    employerId: '1000000123456',
    bankCode: '802920101',
    createdDate: '2026-11-01',
    createdTime: '0930',
    salaryMonth: '102026',
    reference: 'Oct payroll',
    employees: [
      employee,
      { ...employee, personId: '10012345678902', fixed: 300_000n, variable: 0n, leaveDays: '0.0' },
    ],
  });
  const lines = sif.content.trimEnd().split('\r\n');

  it('writes one EDR per worker, amounts in dirhams with two decimals', () => {
    expect(lines[0]).toBe(
      'EDR,10012345678901,803320101,AE070331234567890123456,2026-10-01,2026-10-31,31,2850.00,160.00,1.5',
    );
    expect(lines).toHaveLength(3);
  });

  it('closes with an SCR that counts and totals them', () => {
    expect(lines[2]).toBe(
      'SCR,1000000123456,802920101,2026-11-01,0930,102026,2,6010.00,AED,Oct payroll',
    );
  });

  it('names the file by employer and creation time, with CRLF line endings', () => {
    expect(sif.fileName).toBe('1000000123456261101093000.SIF');
    expect(sif.content.endsWith('\r\n')).toBe(true);
  });

  it('keeps a stray comma out of a field', () => {
    const odd = buildSif({
      employerId: '1000000123456',
      bankCode: '802920101',
      createdDate: '2026-11-01',
      createdTime: '0930',
      salaryMonth: '102026',
      reference: 'Oct, final',
      employees: [],
    });
    expect(odd.content).toContain(',AED,Oct  final');
  });
});

describe('missingWpsDetails', () => {
  it('names what a worker still needs', () => {
    expect(
      missingWpsDetails({ wpsPersonId: null, wpsAgentCode: '803320101', wpsAccount: null }),
    ).toEqual(['MOL personal number', 'IBAN or card number']);
  });
});
