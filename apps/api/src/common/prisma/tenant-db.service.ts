import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { currentAuditActor } from '../audit/audit-context';
import { PrismaService } from './prisma.service';

/**
 * A Prisma client bound to one tenant. Every operation it issues runs inside a
 * transaction that has first done the equivalent of
 * `SET LOCAL app.tenant_id = '<uuid>'`, which is what the RLS policies read
 * (spec §6.1).
 *
 * `SET LOCAL` is scoped to the transaction, so the setting cannot leak onto the
 * next request that happens to reuse the same pooled connection.
 *
 * The same statement also sets who is acting (`app.actor_id`, request id, IP, user agent),
 * which the audit trigger stamps on every row it writes — see `audit-context.ts`.
 */
export type TenantClient = ReturnType<TenantDb['clientFor']>;

/** What an interactive tenant transaction hands to its callback. */
export type TenantTx = Prisma.TransactionClient;

/**
 * A transaction that every `TenantDb` call inside it joins — see `TenantDb.atomically`.
 * AsyncLocalStorage, so it follows the one call chain that opened it and no other request.
 */
interface AmbientTransaction {
  tenantId: string;
  tx: TenantTx;
}
const ambient = new AsyncLocalStorage<AmbientTransaction>();

/** `WorkerProject` → `workerProject`: the delegate a model's operations live on. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `fn` so that every `transaction` and `clientFor` call made inside it — by any service —
   * joins one database transaction, which commits when `fn` returns and rolls back if it throws.
   *
   * This is what lets a spreadsheet import be all or nothing while still creating each row through
   * the module's own service (its checks, its audit trail, its business rules): the services keep
   * opening "their" transactions and simply find themselves inside a bigger one. Used only by the
   * import; everything else behaves exactly as before, because outside `fn` there is no ambient
   * transaction to join.
   */
  async atomically<T>(tenantId: string, fn: () => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T> {
    if (ambient.getStore()) throw new Error('TenantDb.atomically cannot be nested');
    return this.prisma.$transaction(async (tx) => {
      await setContext(tx, tenantId);
      return ambient.run({ tenantId, tx }, fn);
    }, options);
  }

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
          async $allOperations({ model, operation, args, query }) {
            const outer = ambient.getStore();
            if (outer) {
              if (outer.tenantId !== tenantId) throw new Error('A tenant transaction cannot reach another tenant');
              const delegate = (outer.tx as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[
                delegateName(model)
              ]!;
              return delegate[operation]!(args);
            }
            const [, result] = await prisma.$transaction([
              setContext(prisma, tenantId),
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
    const outer = ambient.getStore();
    if (outer) {
      // Inside `atomically`: join it rather than commit on our own.
      if (outer.tenantId !== tenantId) throw new Error('A tenant transaction cannot reach another tenant');
      return fn(outer.tx);
    }
    return this.prisma.$transaction(async (tx) => {
      await setContext(tx, tenantId);
      return fn(tx);
    }, options);
  }
}

/**
 * `set_config(..., is_local => true)` rather than `SET LOCAL`: it accepts a bound
 * parameter, so the tenant id can never be spliced into SQL as text.
 *
 * One statement for the tenant and the audit actor together, so auditing costs no extra
 * round trip on any transaction.
 */
function setContext(
  client: PrismaService | Prisma.TransactionClient,
  tenantId: string,
): Prisma.PrismaPromise<number> {
  const actor = currentAuditActor();
  return client.$executeRaw`SELECT
    set_config('app.tenant_id', ${tenantId}::text, TRUE),
    set_config('app.actor_id', ${actor.actorId}::text, TRUE),
    set_config('app.actor_type', ${actor.actorType}::text, TRUE),
    set_config('app.request_id', ${actor.requestId}::text, TRUE),
    set_config('app.client_ip', ${actor.ip}::text, TRUE),
    set_config('app.user_agent', ${actor.userAgent}::text, TRUE)`;
}
