import { Injectable } from '@nestjs/common';
import { submittalIsInReview, submittalLabel } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import { recordSubmittalReview, type SubmittalReviewNotice } from './submittal-records';
import { SubmittalsService } from './submittals.service';

/**
 * Where submittals meet the client portal's approvals.
 *
 * A client reviews a submittal through the same approval they sign a tile sample off with — one
 * inbox, one record of who decided and when. The portal calls this inside the transaction that
 * records the decision, so the approval and the submittal's review outcome commit together.
 *
 * The portal's answer is yes or no. Yes is "approved"; no is "revise and resubmit" rather than
 * "rejected", because a client's no is nearly always "not like this" — the item stays open for the
 * contractor's next revision, with the client's note as the review comment.
 */
@Injectable()
export class SubmittalApprovalsService {
  constructor(private readonly submittals: SubmittalsService) {}

  async recordDecision(
    tx: TenantTx,
    actor: RequestUser,
    approvalId: string,
    input: { status: 'approved' | 'rejected'; note?: string | null },
  ): Promise<SubmittalReviewNotice | null> {
    const revision = await tx.submittalRevision.findUnique({
      where: { approvalId },
      include: { submittal: { include: { project: { select: { name: true } } } } },
    });
    if (!revision) return null;
    const label = submittalLabel(revision.submittal.number, revision.revision);
    if (revision.submittal.currentRevision !== revision.revision || !submittalIsInReview(revision.status)) {
      throw ApiError.conflict(`${label} is not waiting on the client's review`);
    }
    const me = await tx.user.findFirst({ where: { id: actor.userId }, select: { name: true, email: true } });
    return recordSubmittalReview(tx, {
      tenantId: actor.tenantId,
      submittal: revision.submittal,
      revision,
      outcome: input.status === 'approved' ? 'approved' : 'revise_resubmit',
      comments: input.note ?? null,
      reviewerName: me?.name ?? 'Client',
      reviewerEmail: me?.email ?? null,
      reviewedBy: actor.userId,
      markups: [],
    });
  }

  /** After the commit, and never the reason a decision fails. */
  async notifyDecision(actor: RequestUser, notice: SubmittalReviewNotice | null): Promise<void> {
    await this.submittals.notifyReview(actor.tenantId, notice);
  }

  /**
   * A submittal's approval is not withdrawn on its own while the submittal waits on it: the
   * submittal would be left waiting on nobody.
   */
  async assertWithdrawable(tx: TenantTx, approvalId: string): Promise<void> {
    const revision = await tx.submittalRevision.findUnique({
      where: { approvalId },
      select: { status: true, revision: true, submittal: { select: { number: true } } },
    });
    if (revision && submittalIsInReview(revision.status)) {
      throw ApiError.conflict(
        `This is the client's review of submittal ${submittalLabel(revision.submittal.number, revision.revision)}`,
      );
    }
  }
}
