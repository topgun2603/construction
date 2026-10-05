import { Injectable } from '@nestjs/common';
import { isoDateToUtcDate, taxRule, todayIn, type TaxReportQuery } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantDb } from '../../common/prisma/tenant-db.service';

interface MonthTotals {
  month: string;
  input_tax: string;
  output_tax: string;
}

/**
 * VAT or GST paid and charged over a range (roadmap Phase 1, item 5).
 *
 * Input tax is what the company paid inside its expenses — reclaimable on the return. It counts on
 * the day the money left, and only for expenses not rejected. Output tax is what it charged its
 * clients on instalments, counted when the instalment was raised: that is when the invoice was
 * issued, which is the tax point the return asks for.
 *
 * A worksheet for the accountant, not a filed return: it says so, and it lists the bills that
 * carry tax but no supplier tax number, which a return cannot claim.
 */
@Injectable()
export class TaxReportService {
  constructor(private readonly tenantDb: TenantDb) {}

  async report(actor: RequestUser, query: TaxReportQuery) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const from = isoDateToUtcDate(query.from);
    const to = isoDateToUtcDate(query.to);
    // Raised timestamps run to the end of the last day, on any clock.
    const toEnd = new Date(to.getTime() + 86_400_000);

    const [expenses, stages] = await Promise.all([
      db.expense.findMany({
        where: {
          spentOn: { gte: from, lte: to },
          deletedAt: null,
          status: { not: 'rejected' },
          taxAmount: { gt: 0n },
        },
        select: { spentOn: true, taxAmount: true, supplierTaxId: true },
      }),
      db.paymentStage.findMany({
        where: {
          raisedAt: { gte: from, lt: toEnd },
          deletedAt: null,
          taxAmount: { gt: 0n },
        },
        select: { raisedAt: true, taxAmount: true, amount: true },
      }),
    ]);

    const months = new Map<string, { input: bigint; output: bigint }>();
    const month = (key: string) => {
      const entry = months.get(key) ?? { input: 0n, output: 0n };
      months.set(key, entry);
      return entry;
    };

    let inputTax = 0n;
    let missingTaxId = 0;
    for (const expense of expenses) {
      inputTax += expense.taxAmount;
      if (!expense.supplierTaxId) missingTaxId += 1;
      month(expense.spentOn.toISOString().slice(0, 7)).input += expense.taxAmount;
    }

    let outputTax = 0n;
    let taxableSales = 0n;
    for (const stage of stages) {
      outputTax += stage.taxAmount;
      taxableSales += stage.amount;
      // The month on the company's own calendar, not UTC's.
      const raisedOn = todayIn(actor.timezone, stage.raisedAt!);
      month(raisedOn.slice(0, 7)).output += stage.taxAmount;
    }

    const rule = taxRule(actor.taxRegime);
    return {
      tax_name: rule.taxName,
      standard_rate_bp: rule.standardRateBp,
      from: query.from,
      to: query.to,
      input_tax: inputTax.toString(),
      output_tax: outputTax.toString(),
      /** Positive: owed to the tax authority. Negative: reclaimable. */
      net_tax: (outputTax - inputTax).toString(),
      taxable_sales: taxableSales.toString(),
      expenses_with_tax: expenses.length,
      /** Bills carrying tax but no supplier tax number — their tax cannot be claimed as it stands. */
      missing_supplier_tax_id: missingTaxId,
      by_month: [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map<MonthTotals>(([key, totals]) => ({
          month: key,
          input_tax: totals.input.toString(),
          output_tax: totals.output.toString(),
        })),
    };
  }
}
