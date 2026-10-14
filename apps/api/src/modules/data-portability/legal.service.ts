import { Injectable } from '@nestjs/common';
import type { DataExportLegalAcceptInput } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { env } from '../../config/env';
import { assertOwner } from './owner';

/**
 * Settings → Company → Legal: which version of the data processing agreement the company accepted,
 * by whom and when.
 *
 * The version is deployment config (`DPA_VERSION`) and the text lives wherever `DPA_URL` points —
 * legal text is not something this code writes. Changing the version asks every company to accept
 * the new one; the old acceptances stay as history. Everybody can read the record; only an owner
 * accepts on the company's behalf.
 */
@Injectable()
export class LegalService {
  private readonly config = env();

  constructor(private readonly tenantDb: TenantDb) {}

  /** `GET /legal`. */
  async overview(actor: RequestUser) {
    const history = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.legalAcceptance.findMany({ where: { document: 'dpa' }, orderBy: { acceptedAt: 'desc' }, take: 20 }),
    );
    const current = history.find((row) => row.version === this.config.DPA_VERSION) ?? null;
    return {
      dpa: {
        version: this.config.DPA_VERSION,
        url: this.config.DPA_URL ?? null,
        accepted: current ? present(current) : null,
        can_accept: actor.role === 'owner',
      },
      history: history.map(present),
    };
  }

  /**
   * `POST /legal/accept`. The version sent must be the current one — a page left open across a change
   * of version must not record acceptance of a text the owner never saw. Accepting twice is a no-op.
   */
  async accept(actor: RequestUser, input: DataExportLegalAcceptInput) {
    assertOwner(actor, 'accept the data processing agreement for the company');
    if (input.version !== this.config.DPA_VERSION) {
      throw ApiError.conflict('That is not the current version. Reload the page and read the current one.', {
        current: this.config.DPA_VERSION,
      });
    }
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const existing = await tx.legalAcceptance.findFirst({
        where: { document: input.document, version: input.version },
      });
      if (existing) return;
      const me = await tx.user.findFirst({ where: { id: actor.userId }, select: { name: true } });
      await tx.legalAcceptance.create({
        data: {
          tenantId: actor.tenantId,
          document: input.document,
          version: input.version,
          acceptedByUserId: actor.userId,
          acceptedByName: me?.name ?? 'Owner',
        },
      });
    });
    return this.overview(actor);
  }
}

function present(row: { document: string; version: string; acceptedByName: string; acceptedAt: Date }) {
  return {
    document: row.document,
    version: row.version,
    accepted_by_name: row.acceptedByName,
    accepted_at: row.acceptedAt.toISOString(),
  };
}
