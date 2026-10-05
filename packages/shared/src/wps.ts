import { minorToDecimal } from './money';

/**
 * UAE Wage Protection System salary file — the SIF (roadmap Phase 1, item 1).
 *
 * Gulf salaries must be paid through the government wage system, and the bank or exchange house
 * that pays them takes this file. It is plain comma-separated text: one EDR (employee detail
 * record) per worker paid, then one SCR (salary control record) that totals them.
 *
 *   EDR, person id (14), agent routing code (9), account / IBAN, pay start, pay end,
 *        days in period, fixed income, variable income, days on leave
 *   SCR, employer id (13), employer bank routing code (9), file date, file time (HHMM),
 *        salary month (MMYYYY), EDR count, total salary, AED, employer reference
 *
 * Built from the published layout, but banks and exchange houses differ in what they accept at
 * the edges (a reference field, a trailing comma). Check the first file with the paying agent
 * before it carries a real payroll — the roadmap's own rule for anything regulatory.
 */

export interface SifEmployee {
  personId: string;
  agentCode: string;
  account: string;
  /** `YYYY-MM-DD`. */
  payStart: string;
  payEnd: string;
  daysInPeriod: number;
  /** Fils. */
  fixed: bigint;
  variable: bigint;
  /** `"1.5"`. */
  leaveDays: string;
}

export interface SifInput {
  employerId: string;
  bankCode: string;
  /** The file's own date and time on the company's clock: `YYYY-MM-DD` and `HHMM`. */
  createdDate: string;
  createdTime: string;
  /** `MMYYYY` — the month the salary is for. */
  salaryMonth: string;
  reference?: string;
  employees: SifEmployee[];
}

/** AED has two decimals; the file wants them always, with no grouping. */
const aed = (fils: bigint) => minorToDecimal(fils, 2);

/** A field may not carry the separator. */
const field = (value: string) => value.replace(/[,\r\n]/g, ' ').trim();

export function buildSif(input: SifInput): { fileName: string; content: string } {
  const edr = input.employees.map((employee) =>
    [
      'EDR',
      employee.personId,
      employee.agentCode,
      field(employee.account),
      employee.payStart,
      employee.payEnd,
      String(employee.daysInPeriod),
      aed(employee.fixed),
      aed(employee.variable),
      employee.leaveDays,
    ].join(','),
  );
  const total = input.employees.reduce(
    (sum, employee) => sum + employee.fixed + employee.variable,
    0n,
  );
  const scr = [
    'SCR',
    input.employerId,
    input.bankCode,
    input.createdDate,
    input.createdTime,
    input.salaryMonth,
    String(input.employees.length),
    aed(total),
    'AED',
    field(input.reference ?? ''),
  ].join(',');

  // Employer id, then the file's date and time as YYMMDDHHMMSS (seconds zero).
  const stamp = `${input.createdDate.slice(2).replace(/-/g, '')}${input.createdTime}00`;
  return {
    fileName: `${input.employerId}${stamp}.SIF`,
    content: [...edr, scr].join('\r\n') + '\r\n',
  };
}

/** What a worker still needs before they can be paid through WPS. */
export function missingWpsDetails(worker: {
  wpsPersonId: string | null;
  wpsAgentCode: string | null;
  wpsAccount: string | null;
}): string[] {
  const missing: string[] = [];
  if (!worker.wpsPersonId) missing.push('MOL personal number');
  if (!worker.wpsAgentCode) missing.push('bank routing code');
  if (!worker.wpsAccount) missing.push('IBAN or card number');
  return missing;
}
