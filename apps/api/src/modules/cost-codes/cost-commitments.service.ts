import { Injectable, Logger } from '@nestjs/common';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Something that promises money against a cost code before it is spent: an open purchase order, a
 * subcontract. Procurement and subcontracts register one each; until they exist nothing is
 * committed and the report says so.
 */
export interface CommitmentSource {
  /** For logs and, later, the report's breakdown: `purchase_orders`, `subcontracts`. */
  readonly name: string;
  /**
   * What is still outstanding on one site, per cost code — the value of open orders and contracts
   * **not yet billed**. Billed amounts become actual cost through their own posting, so returning
   * the full order value here would count the same money twice.
   *
   * Runs inside the report's tenant transaction (RLS is already set on `tx`). A null cost code is
   * a commitment nobody coded; the report shows it under "Unallocated".
   */
  outstanding(
    tx: TenantTx,
    projectId: string,
  ): Promise<ReadonlyArray<{ costCodeId: string | null; amount: bigint }>>;
}

/**
 * The one place "committed" is added up.
 *
 * A registry rather than queries against tables that do not exist yet: the module that owns
 * purchase orders knows what "open" means for one, and this module should not have to learn it.
 * A source registers itself once at start-up:
 *
 *   constructor(commitments: CostCommitmentsService) { commitments.register(this); }
 */
@Injectable()
export class CostCommitmentsService {
  private readonly logger = new Logger(CostCommitmentsService.name);
  private readonly sources = new Map<string, CommitmentSource>();

  register(source: CommitmentSource): void {
    if (this.sources.has(source.name)) {
      this.logger.warn({ source: source.name }, 'Commitment source registered twice; keeping the last');
    }
    this.sources.set(source.name, source);
  }

  /** Names of the registered sources, so the report can say what "committed" includes. */
  sourceNames(): string[] {
    return [...this.sources.keys()];
  }

  /**
   * Outstanding commitments on one site, summed per cost code (`null` = uncoded). Every source's
   * amounts are added; an empty map until a source is registered.
   */
  async committedByCostCode(tx: TenantTx, projectId: string): Promise<Map<string | null, bigint>> {
    const totals = new Map<string | null, bigint>();
    for (const source of this.sources.values()) {
      for (const row of await source.outstanding(tx, projectId)) {
        if (row.amount === 0n) continue;
        totals.set(row.costCodeId, (totals.get(row.costCodeId) ?? 0n) + row.amount);
      }
    }
    return totals;
  }
}
