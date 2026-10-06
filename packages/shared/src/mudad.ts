import { minorToDecimal } from './money';

/**
 * Saudi Arabia's Wage Protection System payroll file, uploaded through Mudad (or the paying bank's
 * own payroll channel) once a month — the Saudi counterpart of the UAE's SIF in `wps.ts`.
 *
 * Plain comma-separated text, UTF-8 without a byte-order mark, CRLF line endings: one row of
 * column titles, then one row per employee paid, in this order:
 *
 *    1  Employee ID          Iqama (residents, starts with 2) or national ID (citizens, starts
 *                            with 1) — ten digits
 *    2  Employee name
 *    3  Bank code            the employee's bank, as its SARIE / SWIFT BIC ("RJHISARI")
 *    4  IBAN                 SA + 22 digits
 *    5  Basic salary         SAR, always two decimals, no grouping
 *    6  Housing allowance    SAR
 *    7  Other earnings       SAR — transport, food, overtime and anything else paid
 *    8  Deductions           SAR — advances recovered and other deductions
 *    9  Net salary           SAR — always 5 + 6 + 7 − 8, worked out here rather than trusted
 *   10  Establishment number the employer's MHRSD number, labour office id and sequence: "1-123456"
 *   11  Salary month         YYYY-MM
 *
 * Built from the shape of Mudad's bulk salary template and the Saudi banks' WPS payroll uploads as
 * they are generally described, **not** from a specification anybody has signed off. Mudad's own
 * template and each bank's channel differ at the edges — the column titles, whether a totals row is
 * wanted, Arabic names — so the first file must be checked with the employer's bank or in Mudad
 * before it carries a real payroll. That is the roadmap's own rule for anything regulatory.
 */

export const MUDAD_COLUMNS = [
  'Employee ID',
  'Employee Name',
  'Bank Code',
  'IBAN',
  'Basic Salary',
  'Housing Allowance',
  'Other Earnings',
  'Deductions',
  'Net Salary',
  'Establishment Number',
  'Salary Month',
] as const;

/**
 * Major banks in Saudi Arabia: the two-digit bank identifier inside a Saudi IBAN (characters 5–6)
 * and the bank's SARIE / SWIFT BIC.
 *
 * Static on purpose — the list changes when banks merge, a few times a decade, and the codes are
 * public. Confirm a code with the bank before the first file; an unknown IBAN prefix is reported as
 * a missing bank code rather than guessed.
 */
export const MUDAD_SAUDI_BANKS: ReadonlyArray<{ id: string; bic: string; name: string }> =
  Object.freeze([
    { id: '05', bic: 'INMASARI', name: 'Alinma Bank' },
    { id: '10', bic: 'NCBKSAJE', name: 'Saudi National Bank' },
    { id: '15', bic: 'ALBISARI', name: 'Bank AlBilad' },
    { id: '20', bic: 'RIBLSARI', name: 'Riyad Bank' },
    { id: '30', bic: 'ARNBSARI', name: 'Arab National Bank' },
    { id: '40', bic: 'SAMBSARI', name: 'Samba (now Saudi National Bank)' },
    { id: '45', bic: 'SABBSARI', name: 'Saudi Awwal Bank (SAB)' },
    { id: '50', bic: 'AAALSARI', name: 'Alawwal Bank (now SAB)' },
    { id: '55', bic: 'BSFRSARI', name: 'Banque Saudi Fransi' },
    { id: '60', bic: 'BJAZSAJE', name: 'Bank AlJazira' },
    { id: '65', bic: 'SIBCSARI', name: 'Saudi Investment Bank' },
    { id: '71', bic: 'NBOBSARI', name: 'National Bank of Bahrain' },
    { id: '75', bic: 'NBOKSAJE', name: 'National Bank of Kuwait' },
    { id: '76', bic: 'BMUSSARI', name: 'Bank Muscat' },
    { id: '80', bic: 'RJHISARI', name: 'Al Rajhi Bank' },
    { id: '90', bic: 'GULFSARI', name: 'Gulf International Bank' },
    { id: '95', bic: 'EBILSARI', name: 'Emirates NBD' },
  ]);

const SAUDI_IBAN = /^SA[0-9]{22}$/;

/** Spaces and lower case are how people type an IBAN; neither belongs in the file. */
export function mudadNormaliseIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * A Saudi IBAN: SA, two check digits, then 20 digits (bank id and account), and the ISO 7064
 * mod-97 check passing — which catches a mistyped digit or two swapped ones before the bank does.
 */
export function mudadIbanValid(iban: string): boolean {
  const value = mudadNormaliseIban(iban);
  if (!SAUDI_IBAN.test(value)) return false;
  // Country and check digits move to the end, letters become 10–35, and the number mod 97 is 1.
  const rearranged = `${value.slice(4)}${value.slice(0, 4)}`.replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  // Digit by digit, so no number grows past what a double holds exactly.
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** The bank a Saudi IBAN belongs to, from its two-digit bank id, if it is one we list. */
export function mudadBankForIban(iban: string): (typeof MUDAD_SAUDI_BANKS)[number] | undefined {
  const value = mudadNormaliseIban(iban);
  if (!value.startsWith('SA') || value.length < 6) return undefined;
  return MUDAD_SAUDI_BANKS.find((bank) => bank.id === value.slice(4, 6));
}

/**
 * Which kind of Saudi identity number this is: ten digits, a citizen's national ID starting with 1
 * and a resident's Iqama with 2. Anything else is not one.
 */
export function mudadIdKind(id: string): 'national_id' | 'iqama' | null {
  const value = id.trim();
  if (!/^[12][0-9]{9}$/.test(value)) return null;
  return value.startsWith('1') ? 'national_id' : 'iqama';
}

/** "1-123456": labour office id, a dash, the establishment's sequence number. */
export const MUDAD_ESTABLISHMENT_PATTERN = /^[0-9]{1,3}-[0-9]{1,10}$/;

/**
 * What a worker still needs before they can go into a Mudad file — in words the screen shows next
 * to their name, so the person paying knows which field to open.
 */
export function missingMudadDetails(worker: {
  /** The Iqama or national ID number, from the worker's papers. */
  idNumber: string | null;
  iban: string | null;
  /** An explicit BIC, when the IBAN's bank is not one we list. */
  bankCode?: string | null;
}): string[] {
  const missing: string[] = [];
  if (!worker.idNumber) missing.push('Iqama or national ID');
  else if (!mudadIdKind(worker.idNumber)) missing.push('a valid Iqama or national ID (10 digits)');
  if (!worker.iban) missing.push('IBAN');
  else if (!mudadIbanValid(worker.iban)) missing.push('a valid Saudi IBAN (SA + 22 digits)');
  else if (!worker.bankCode && !mudadBankForIban(worker.iban)) missing.push('bank code');
  return missing;
}

export interface MudadEmployee {
  idNumber: string;
  name: string;
  /** BIC. Worked out from the IBAN by the caller when not set; see `mudadBankForIban`. */
  bankCode: string;
  iban: string;
  /** Halalas, like every amount here. */
  basic: bigint;
  housing: bigint;
  other: bigint;
  deductions: bigint;
}

export interface MudadInput {
  establishment: string;
  /** `YYYY-MM` — the month the salary is for. */
  salaryMonth: string;
  employees: MudadEmployee[];
}

/** SAR has two decimals; the file wants them always, with no grouping. */
const sar = (halalas: bigint) => minorToDecimal(halalas, 2);

/**
 * A field may not carry the separator or a line break. Quoting would be legal CSV, but bank upload
 * parsers are not all CSV parsers, so the character is dropped instead — the same rule as the SIF.
 */
const field = (value: string) => value.replace(/[,"\r\n]/g, ' ').replace(/\s+/g, ' ').trim();

/** The net an employee is paid: what they earned less what was deducted. */
export function mudadNet(employee: Pick<MudadEmployee, 'basic' | 'housing' | 'other' | 'deductions'>) {
  return employee.basic + employee.housing + employee.other - employee.deductions;
}

export function buildMudadFile(input: MudadInput): {
  fileName: string;
  content: string;
  total: bigint;
} {
  const rows = input.employees.map((employee) =>
    [
      employee.idNumber.trim(),
      field(employee.name),
      field(employee.bankCode).toUpperCase(),
      mudadNormaliseIban(employee.iban),
      sar(employee.basic),
      sar(employee.housing),
      sar(employee.other),
      sar(employee.deductions),
      sar(mudadNet(employee)),
      input.establishment,
      input.salaryMonth,
    ].join(','),
  );
  const total = input.employees.reduce((sum, employee) => sum + mudadNet(employee), 0n);
  return {
    fileName: `MUDAD-${input.establishment}-${input.salaryMonth.replace('-', '')}.csv`,
    content: [MUDAD_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n',
    total,
  };
}

/**
 * One wage line split into the columns Mudad asks for.
 *
 * A wage line knows its gross, its fixed part (day wages or salary), and its net after advances.
 * A monthly worker's fixed part is shared between basic and housing in the proportion their salary
 * is set up with — a month with unpaid leave shrinks both, as it does on the payslip — and
 * everything else earned (transport, food, overtime) is "other". A day-wage worker's wages are all
 * basic. Deductions are whatever separates gross from net, so the row always adds up to the net
 * actually transferred.
 */
export function mudadSplitPay(line: {
  gross: bigint;
  fixed: bigint;
  net: bigint;
  basicSalary: bigint | null;
  housingAllowance: bigint;
  transportAllowance: bigint;
  foodAllowance: bigint;
  payBasis: string;
}): Pick<MudadEmployee, 'basic' | 'housing' | 'other' | 'deductions'> {
  const fixed = line.fixed > line.gross ? line.gross : line.fixed;
  let basic = fixed;
  let housing = 0n;
  if (line.payBasis === 'monthly' && line.basicSalary !== null) {
    const monthly =
      line.basicSalary + line.housingAllowance + line.transportAllowance + line.foodAllowance;
    if (monthly > 0n) {
      basic = (fixed * line.basicSalary) / monthly;
      housing = (fixed * line.housingAllowance) / monthly;
    }
  }
  // A net above gross (a bonus carried in) is still money paid, so it is earnings, not a negative
  // deduction the bank would refuse.
  const extra = line.net > line.gross ? line.net - line.gross : 0n;
  const other = line.gross - basic - housing + extra;
  const deductions = line.gross > line.net ? line.gross - line.net : 0n;
  return { basic, housing, other, deductions };
}
