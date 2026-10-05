import { Injectable } from '@nestjs/common';
import { lineAmount, utcDateToIsoDate, type IsoDate } from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import type { ActualCostRow, ActualCostSource } from '../cost-codes/cost-actuals.service';
import { CostActualsService } from '../cost-codes/cost-actuals.service';
import {
  CostCommitmentsService,
  type CommitmentSource,
} from '../cost-codes/cost-commitments.service';
import {
  LEDGER_INCLUDE,
  SETTLED,
  billableLines,
  certifiedValueByLine,
  usedQuantity,
  type Ledger,
} from './subcontract-ledger';

/** A subcontract that still promises money: let and running, or finished but not yet closed. */
const COMMITTING = ['active', 'completed'] as const;

/**
 * How subcontracts reach the cost report — the one place the "no double counting" rule lives.
 *
 * - **Committed** is each contract line's value (original lines and approved variations) less what
 *   has been certified on it to date. Drafts promise nothing yet; closed and terminated contracts
 *   promise nothing more.
 * - **Actual** is what certified bills say the work is worth, line by line, net of tax (the
 *   subcontractor's GST or VAT is reclaimable, not cost), on the bill's period end. Back-charges come
 *   off the line they are coded to: the material we supplied was booked as our own expense, and the
 *   subcontractor's rate includes it, so without the recovery it would be counted twice. Retention
 *   and advance recovery are not cost at all — they are when the money moves, not what the work is
 *   worth.
 *
 * Certifying a bill therefore moves exactly its gross from committed to actual: the two together
 * stay at the contract value until a variation changes it.
 */
@Injectable()
export class SubcontractCostsService implements CommitmentSource, ActualCostSource {
  readonly name = 'subcontracts';

  constructor(commitments: CostCommitmentsService, actuals: CostActualsService) {
    commitments.register(this);
    actuals.register(this);
  }

  async outstanding(tx: TenantTx, projectId: string) {
    const ledgers = await this.ledgers(tx, projectId, [...COMMITTING]);
    const rows: Array<{ costCodeId: string | null; amount: bigint }> = [];
    for (const ledger of ledgers) {
      const certified = certifiedValueByLine(ledger);
      for (const line of billableLines(ledger)) {
        const left = line.amount - (certified.get(line.id) ?? 0n);
        if (left > 0n) rows.push({ costCodeId: line.costCodeId, amount: left });
      }
    }
    return rows;
  }

  async actuals(tx: TenantTx, projectId: string, upTo: IsoDate): Promise<ActualCostRow[]> {
    // Every status but draft: a terminated contract's certified bills were still cost.
    const ledgers = await this.ledgers(tx, projectId, ['active', 'completed', 'closed', 'terminated']);
    const rows: ActualCostRow[] = [];
    for (const ledger of ledgers) {
      const lines = new Map(ledger.lines.map((line) => [line.id, line]));
      const previous = new Map<string, bigint>();
      const label = `Subcontract · ${ledger.number}`;
      for (const bill of ledger.bills) {
        if (!SETTLED.has(bill.status)) continue;
        // A bill dated ahead still counts — its commitment has already gone — but the trend reads
        // it as today's.
        const periodEnd = utcDateToIsoDate(bill.periodTo);
        const date = periodEnd > upTo ? upTo : periodEnd;
        for (const row of bill.lines) {
          const line = lines.get(row.lineId);
          if (!line) continue;
          const now = usedQuantity(row);
          const before = previous.get(row.lineId) ?? 0n;
          previous.set(row.lineId, now);
          const amount = lineAmount(now, line.rate) - lineAmount(before, line.rate);
          if (amount !== 0n) rows.push({ costCodeId: line.costCodeId, amount, date, line: label });
        }
        for (const deduction of bill.deductionRows) {
          rows.push({
            costCodeId: deduction.costCodeId,
            amount: -deduction.amount,
            date,
            line: `${label} back-charge`,
          });
        }
      }
    }
    return rows;
  }

  private ledgers(tx: TenantTx, projectId: string, statuses: Ledger['status'][]): Promise<Ledger[]> {
    return tx.subcontract.findMany({
      where: { projectId, status: { in: statuses } },
      include: LEDGER_INCLUDE,
    });
  }
}
