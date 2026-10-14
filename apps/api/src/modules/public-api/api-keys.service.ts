import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  PUBLIC_API_MAX_KEYS,
  publicApiKeyState,
  type PublicApiKeyCreateInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';
import { ApiKeyHasher } from './api-key-hasher';

const KEY_SELECT = {
  id: true,
  name: true,
  keyLast4: true,
  scopes: true,
  allowedCidrs: true,
  expiresAt: true,
  createdByUserId: true,
  lastUsedAt: true,
  lastUsedIp: true,
  revokedAt: true,
  createdAt: true,
} as const;

type KeyRow = {
  id: string;
  name: string;
  keyLast4: string;
  scopes: string[];
  allowedCidrs: string[];
  expiresAt: Date | null;
  createdByUserId: string;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/**
 * Settings → Developers → API keys. Owner only: a key reads company data without anybody signing in,
 * which is the same weight as the security settings, and no role can be handed it.
 *
 * Making and revoking a key are audited by the `api_keys` row trigger (the hash redacted by name).
 */
@Injectable()
export class ApiKeysService {
  private readonly hasher = ApiKeyHasher.fromEnv(env());

  constructor(private readonly tenantDb: TenantDb) {}

  async list(actor: RequestUser) {
    assertOwner(actor);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const rows = await db.apiKey.findMany({ orderBy: { createdAt: 'desc' }, select: KEY_SELECT });
    const makers = await db.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.createdByUserId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(makers.map((user) => [user.id, user.name]));
    const now = new Date();
    return {
      configured: this.hasher !== null,
      keys: rows.map((row) => keyView(row, now, names.get(row.createdByUserId) ?? null)),
    };
  }

  /** The key itself is in this answer and nowhere else, ever. */
  async create(actor: RequestUser, input: PublicApiKeyCreateInput) {
    assertOwner(actor);
    if (!this.hasher) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONFLICT,
        'API keys are not set up on this server (API_KEY_PEPPER is missing).',
        { public_api: 'not_configured' },
      );
    }
    const expiresAt = input.expires_at ? new Date(input.expires_at) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw ApiError.validationFailed({ expires_at: 'in the past' }, 'The expiry has to be in the future.');
    }

    const generated = this.hasher.generate();
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const live = await tx.apiKey.count({ where: { revokedAt: null } });
      if (live >= PUBLIC_API_MAX_KEYS) {
        throw ApiError.conflict(`A company can have at most ${PUBLIC_API_MAX_KEYS} API keys. Revoke one you no longer use.`);
      }
      return tx.apiKey.create({
        data: {
          tenantId: actor.tenantId,
          name: input.name,
          keyHash: generated.hash,
          keyLast4: generated.last4,
          scopes: input.scopes,
          allowedCidrs: input.allowed_cidrs,
          expiresAt,
          createdByUserId: actor.userId,
        },
        select: KEY_SELECT,
      });
    });
    return { key: keyView(row, new Date(), null), secret: generated.key };
  }

  /** Stops working on the next request: the trigger drops it from the directory in this transaction. */
  async revoke(actor: RequestUser, id: string) {
    assertOwner(actor);
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = await tx.apiKey.findFirst({ where: { id }, select: { revokedAt: true } });
      if (!existing) throw ApiError.notFound('API key');
      if (existing.revokedAt) throw ApiError.conflict('That key is already revoked.');
      return tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date(), revokedByUserId: actor.userId },
        select: KEY_SELECT,
      });
    });
    return keyView(row, new Date(), null);
  }
}

function assertOwner(actor: RequestUser): void {
  if (actor.role !== 'owner') throw ApiError.forbidden('Only an owner can manage API keys.');
}

function keyView(row: KeyRow, now: Date, createdByName: string | null) {
  return {
    id: row.id,
    name: row.name,
    // Enough to recognise it in a config file; nowhere near enough to use it.
    hint: `bk_live_…${row.keyLast4}`,
    scopes: row.scopes,
    allowed_cidrs: row.allowedCidrs,
    expires_at: row.expiresAt?.toISOString() ?? null,
    state: publicApiKeyState(row, now),
    created_by: { id: row.createdByUserId, name: createdByName },
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    last_used_ip: row.lastUsedIp,
    revoked_at: row.revokedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
