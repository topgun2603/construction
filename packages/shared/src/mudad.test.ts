import { describe, expect, it } from 'vitest';
import {
  buildMudadFile,
  missingMudadDetails,
  MUDAD_ESTABLISHMENT_PATTERN,
  mudadBankForIban,
  mudadIbanValid,
  mudadIdKind,
  mudadSplitPay,
} from './mudad';

// The registry's own Saudi example: Al Rajhi (bank id 80), check digits 03.
const IBAN = 'SA0380000000608010167519';

describe('mudadIbanValid', () => {
  it('accepts a real Saudi IBAN, spaced or not', () => {
    expect(mudadIbanValid(IBAN)).toBe(true);
    expect(mudadIbanValid('sa03 8000 0000 6080 1016 7519')).toBe(true);
  });

  it('refuses a wrong check digit, a swapped pair, the wrong length or country', () => {
    expect(mudadIbanValid('SA0480000000608010167519')).toBe(false);
    expect(mudadIbanValid('SA0380000000608010167591')).toBe(false);
    expect(mudadIbanValid('SA038000000060801016751')).toBe(false);
    expect(mudadIbanValid('AE070331234567890123456')).toBe(false);
    expect(mudadIbanValid('SA03800000006080101675AB')).toBe(false);
  });
});

describe('mudadBankForIban', () => {
  it('reads the bank from the IBAN', () => {
    expect(mudadBankForIban(IBAN)?.bic).toBe('RJHISARI');
    expect(mudadBankForIban('SA4420000001234567891234')?.bic).toBe('RIBLSARI');
  });

  it('knows nothing about a bank id it does not list', () => {
    expect(mudadBankForIban('SA0399000000608010167519')).toBeUndefined();
  });
});

describe('mudadIdKind', () => {
  it('tells a citizen from a resident by the first digit', () => {
    expect(mudadIdKind('1012345678')).toBe('national_id');
    expect(mudadIdKind('2123456789')).toBe('iqama');
  });

  it('refuses anything else', () => {
    expect(mudadIdKind('3123456789')).toBeNull();
    expect(mudadIdKind('212345678')).toBeNull();
    expect(mudadIdKind('21234567890')).toBeNull();
  });
});

describe('missingMudadDetails', () => {
  it('lists each thing missing', () => {
    expect(missingMudadDetails({ idNumber: null, iban: null })).toEqual([
      'Iqama or national ID',
      'IBAN',
    ]);
  });

  it('says when what is there is wrong', () => {
    expect(missingMudadDetails({ idNumber: '9999', iban: 'SA0480000000608010167519' })).toEqual([
      'a valid Iqama or national ID (10 digits)',
      'a valid Saudi IBAN (SA + 22 digits)',
    ]);
  });

  it('wants a bank code only when the IBAN does not name a bank we know', () => {
    expect(missingMudadDetails({ idNumber: '2123456789', iban: IBAN })).toEqual([]);
    // A valid IBAN at an unlisted bank id: compute its check digits to keep the test honest.
    const unlisted = withCheckDigits('99000000608010167519');
    expect(mudadIbanValid(unlisted)).toBe(true);
    expect(missingMudadDetails({ idNumber: '2123456789', iban: unlisted })).toEqual(['bank code']);
    expect(
      missingMudadDetails({ idNumber: '2123456789', iban: unlisted, bankCode: 'XXXXSARI' }),
    ).toEqual([]);
  });
});

describe('MUDAD_ESTABLISHMENT_PATTERN', () => {
  it('is office, dash, sequence', () => {
    expect(MUDAD_ESTABLISHMENT_PATTERN.test('1-123456')).toBe(true);
    expect(MUDAD_ESTABLISHMENT_PATTERN.test('123456')).toBe(false);
  });
});

describe('buildMudadFile', () => {
  const file = buildMudadFile({
    establishment: '1-123456',
    salaryMonth: '2026-10',
    employees: [
      {
        idNumber: '2123456789',
        name: 'Ramesh, Kumar',
        bankCode: 'RJHISARI',
        iban: 'sa03 8000 0000 6080 1016 7519',
        basic: 300_000n,
        housing: 75_000n,
        other: 30_050n,
        deductions: 20_000n,
      },
      {
        idNumber: '1012345678',
        name: 'Fahad Al-Harbi',
        bankCode: 'ribl sari',
        iban: 'SA4420000001234567891234',
        basic: 500_000n,
        housing: 0n,
        other: 0n,
        deductions: 0n,
      },
    ],
  });
  const lines = file.content.trimEnd().split('\r\n');

  it('starts with the column titles', () => {
    expect(lines[0]).toBe(
      'Employee ID,Employee Name,Bank Code,IBAN,Basic Salary,Housing Allowance,Other Earnings,Deductions,Net Salary,Establishment Number,Salary Month',
    );
  });

  it('writes one row per employee in riyals with two decimals, net worked out', () => {
    expect(lines[1]).toBe(
      '2123456789,Ramesh Kumar,RJHISARI,SA0380000000608010167519,3000.00,750.00,300.50,200.00,3850.50,1-123456,2026-10',
    );
    expect(lines[2]).toBe(
      '1012345678,Fahad Al-Harbi,RIBL SARI,SA4420000001234567891234,5000.00,0.00,0.00,0.00,5000.00,1-123456,2026-10',
    );
    expect(lines).toHaveLength(3);
  });

  it('totals the nets and names the file by establishment and month, CRLF throughout', () => {
    expect(file.total).toBe(885_050n);
    expect(file.fileName).toBe('MUDAD-1-123456-202610.csv');
    expect(file.content.endsWith('\r\n')).toBe(true);
  });
});

describe('mudadSplitPay', () => {
  it('shares a monthly worker’s fixed pay between basic and housing as set up', () => {
    // 3,000 basic + 750 housing + 250 transport; a full month, 300.50 overtime, 200 advance.
    const split = mudadSplitPay({
      gross: 430_050n,
      fixed: 400_000n,
      net: 410_050n,
      basicSalary: 300_000n,
      housingAllowance: 75_000n,
      transportAllowance: 25_000n,
      foodAllowance: 0n,
      payBasis: 'monthly',
    });
    expect(split).toEqual({ basic: 300_000n, housing: 75_000n, other: 55_050n, deductions: 20_000n });
    expect(split.basic + split.housing + split.other - split.deductions).toBe(410_050n);
  });

  it('puts a day-wage worker’s wages all in basic', () => {
    expect(
      mudadSplitPay({
        gross: 100_000n,
        fixed: 90_000n,
        net: 100_000n,
        basicSalary: null,
        housingAllowance: 0n,
        transportAllowance: 0n,
        foodAllowance: 0n,
        payBasis: 'daily',
      }),
    ).toEqual({ basic: 90_000n, housing: 0n, other: 10_000n, deductions: 0n });
  });
});

/** Builds a valid Saudi IBAN from its 20-digit body. */
function withCheckDigits(body: string): string {
  const numeric = `${body}281000`; // "SA00" → S=28, A=10, 00
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return `SA${String(98 - remainder).padStart(2, '0')}${body}`;
}
