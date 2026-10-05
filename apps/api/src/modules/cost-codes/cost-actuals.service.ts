import { Injectable, Logger } from '@nestjs/common';
import type { IsoDate } from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/** One piece of actual cost from a source other than expenses and the roll call. */
export interface ActualCostRow {
  /** Null lands under "Unallocated", like an uncoded expense. */
  costCodeId: string | null;
  /** Minor units. Negative for a recovery — a back-charge gives cost back to the line that bore it. */
  amount: bigint;
  /** The day the cost belongs to, for the forecast's trend. */
  date: IsoDate;
  /** What the forecast card's breakdown calls it: `Subcontract · SC-007`. */
  line: string;
}

/**
 * Something that turns into actual cost through its own record rather than an expense row — a
 * certified subcontract bill, and later a goods receipt.
 *
 * Why a second source instead of writing expense rows: an expense is petty cash with its own life —
 * submitted, approved by somebody else, edited, deleted, its tax reclaimed on the VAT report. A
 * certified bill copied into one would be counted again by anything that reads both tables, could be
 * edited out of step with the certificate it came from, and would put a subcontractor's GST on the
 * company's input-tax report as if it were a till receipt. The source owns its figures; the report
 * only adds them up.
 */
export interface ActualCostSource {
  readonly name: string;
  /** Cost on one site up to and including `upTo`. Runs inside the report's tenant transaction. */
  actuals(tx: TenantTx, projectId: string, upTo: IsoDate): Promise<ReadonlyArray<ActualCostRow>>;
}

/**
 * The registry of extra actual-cost sources, the counterpart of `CostCommitmentsService`. A source
 * registers itself once at start-up and the cost report adds its rows beside expenses and labour.
 */
@Injectable()
export class CostActualsService {
  private readonly logger = new Logger(CostActualsService.name);
  private readonly sources = new Map<string, ActualCostSource>();

  register(source: ActualCostSource): void {
    if (this.sources.has(source.name)) {
      this.logger.warn({ source: source.name }, 'Actual cost source registered twice; keeping the last');
    }
    this.sources.set(source.name, source);
  }

  sourceNames(): string[] {
    return [...this.sources.keys()];
  }

  async actualsFor(tx: TenantTx, projectId: string, upTo: IsoDate): Promise<ActualCostRow[]> {
    const rows: ActualCostRow[] = [];
    for (const source of this.sources.values()) {
      rows.push(...(await source.actuals(tx, projectId, upTo)));
    }
    return rows;
  }
}
