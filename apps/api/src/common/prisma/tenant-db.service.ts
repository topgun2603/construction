import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * A Prisma client bound to one tenant. Every operation it issues runs inside a
 * transaction that has first done the equivalent of
 * `SET LOCAL app.tenant_id = '<uuid>'`, which is what the RLS policies read
 * (spec §6.1).
 *
 * `SET LOCAL` is scoped to the transaction, so the setting cannot leak onto the
 * next request that happens to reuse the same pooled connection.
 */
export type TenantClient = ReturnType<TenantDb['clientFor']>;

/** What an interactive tenant transaction hands to its callback. */
export type TenantTx = Prisma.TransactionClient;

@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Client for one-shot operations. Each call wraps itself in its own transaction,
   * so two operations on this client are *not* atomic together — use `transaction`
   * when they need to be.
   */
  clientFor(tenantId: string) {
    const prisma = this.prisma;
    return prisma.$extends({
      name: 'tenant-rls',
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const [, result] = await prisma.$transaction([
              setTenant(prisma, tenantId),
              query(args),
            ]);
            return result;
          },
        },
      },
    });
  }

  /**
   * Interactive transaction with the tenant context set. Use for multi-statement
   * work that has to commit or roll back as one unit — wage period finalisation,
   * bulk attendance upserts, sync push batches.
   */
  async transaction<T>(
    tenantId: string,
    fn: (tx: TenantTx) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}::text, TRUE)`;
      return fn(tx);
    }, options);
  }
}

/**
 * `set_config(..., is_local => true)` rather than `SET LOCAL`: it accepts a bound
 * parameter, so the tenant id can never be spliced into SQL as text.
 */
function setTenant(prisma: PrismaService, tenantId: string): Prisma.PrismaPromise<number> {
  return prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}::text, TRUE)`;
}
