import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { TenantCache } from '../../common/auth/tenant-cache.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ScimError } from './scim-error';

/** The company a SCIM request is for, established from its bearer token and nothing else. */
export interface ScimRequest extends Request {
  scim?: { tenantId: string };
}

/** `last_used_at` is written at most this often, so a provisioning burst is not a write per call. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Authenticates a SCIM call by its bearer token.
 *
 * The token's SHA-256 is looked up in `scim_token_directory` — the trigger-kept, RLS-free mirror
 * of live tokens, which answers "which company?" and nothing else — and then confirmed against
 * `scim_tokens` inside that company's RLS scope. Only the hash is stored anywhere, so a database
 * dump does not hand out provisioning access. A wrong, revoked or malformed token is one answer:
 * 401, so the endpoint cannot be used to tell them apart.
 */
@Injectable()
export class ScimAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly tenantCache: TenantCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ScimRequest>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorised();

    const tokenHash = createHash('sha256').update(token.trim()).digest('hex');
    const entry = await this.prisma.scimTokenDirectory.findUnique({
      where: { tokenHash },
      select: { tenantId: true },
    });
    if (!entry) throw unauthorised();

    const stored = await this.tenantDb.transaction(entry.tenantId, (tx) =>
      tx.scimToken.findFirst({
        where: { tokenHash, revokedAt: null },
        select: { id: true, lastUsedAt: true },
      }),
    );
    if (!stored) throw unauthorised();

    // A suspended company provisions nobody, the same as it signs nobody in.
    const tenant = await this.tenantCache.get(entry.tenantId);
    if (!tenant || tenant.status !== 'active') {
      throw new ScimError(HttpStatus.FORBIDDEN, 'This company is suspended');
    }

    if (!stored.lastUsedAt || Date.now() - stored.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.tenantDb.transaction(entry.tenantId, (tx) =>
        tx.scimToken.update({ where: { id: stored.id }, data: { lastUsedAt: new Date() } }),
      );
    }

    request.scim = { tenantId: entry.tenantId };
    return true;
  }
}

function unauthorised(): ScimError {
  return new ScimError(HttpStatus.UNAUTHORIZED, 'A valid SCIM bearer token is required');
}
