import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantDb } from '../../common/prisma/tenant-db.service';

/** The audit actions this feature writes by hand, beside what the row triggers already record. */
export type SecurityAuditAction =
  | 'security.sign_in_refused'
  | 'security.session_timed_out'
  | 'security.sessions_revoked'
  | 'security.request_refused'
  | 'mfa.verified'
  | 'mfa.verify_failed'
  | 'mfa.locked'
  | 'mfa.enrolled'
  | 'mfa.removed'
  | 'mfa.recovery_codes_regenerated';

/**
 * Hand-written audit entries for the things a row trigger cannot see: a sign-in that was refused
 * (nothing was written, so there is no row to trigger on), a wrong code, a timed-out session.
 *
 * Each entry is its own committed transaction, because most are written on the way to throwing —
 * inside the request's transaction the refusal would roll its own record back. A failure to log is
 * logged and swallowed: the refusal is what protects the company, and it must not be masked by a
 * log line that could not be written.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(private readonly tenantDb: TenantDb) {}

  async record(
    tenantId: string,
    entry: {
      actorId: string | null;
      action: SecurityAuditAction;
      entity: string;
      entityId?: string | null;
      after?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    try {
      await this.tenantDb.transaction(tenantId, async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: entry.actorId,
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId ?? null,
            ...(entry.after === undefined ? {} : { after: entry.after }),
          },
        });
      });
    } catch (error) {
      this.logger.warn({ err: error, action: entry.action }, 'Could not record a security audit entry');
    }
  }
}
