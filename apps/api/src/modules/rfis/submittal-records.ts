import { Prisma } from '@prisma/client';
import {
  submittalLabel,
  type SubmittalOutcome,
} from '@sitebook/shared';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import { FILE_SELECT, type ResolvedFile } from './rfi-common';

/**
 * The submittal record shapes and the one write every reviewer path shares — the consultant through
 * their link, a manager recording a stamped return, the client through the portal's approvals — so
 * the three cannot disagree about what a review sets.
 */

export const SUBMITTAL_INCLUDE = {
  project: { select: { id: true, name: true } },
  costCode: { select: { id: true, code: true, name: true } },
  contractor: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  revisions: {
    orderBy: { revision: 'desc' },
    include: {
      files: { orderBy: { createdAt: 'asc' }, select: { ...FILE_SELECT, role: true } },
      approval: { select: { id: true, status: true, decidedAt: true } },
    },
  },
} as const;

export type SubmittalRecord = Prisma.SubmittalGetPayload<{ include: typeof SUBMITTAL_INCLUDE }>;
export type SubmittalRevisionRecord = SubmittalRecord['revisions'][number];

export function currentRevisionOf(row: SubmittalRecord): SubmittalRevisionRecord {
  const current = row.revisions.find((revision) => revision.revision === row.currentRevision);
  // The revision rows and `currentRevision` are written together; a missing one is a bug, loudly.
  if (!current) throw new Error(`Submittal ${row.id} has no revision ${row.currentRevision}`);
  return current;
}

export interface SubmittalReviewNotice {
  submittalId: string;
  projectId: string;
  projectName: string;
  label: string;
  title: string;
  outcome: SubmittalOutcome;
  recipients: string[];
}

/**
 * Stamp a review on a revision and mirror it on the submittal, in the caller's transaction. The
 * caller has already checked the revision is the current one and waiting on a review.
 */
export async function recordSubmittalReview(
  tx: TenantTx,
  input: {
    tenantId: string;
    submittal: { id: string; number: number; title: string; projectId: string; createdBy: string; project: { name: string } };
    revision: { id: string; revision: number; submittedBy: string | null };
    outcome: SubmittalOutcome;
    comments: string | null;
    reviewerName: string;
    reviewerEmail: string | null;
    reviewedBy: string | null;
    markups: readonly ResolvedFile[];
  },
): Promise<SubmittalReviewNotice> {
  const now = new Date();
  await tx.submittalRevision.update({
    where: { id: input.revision.id },
    data: {
      status: input.outcome,
      reviewedAt: now,
      reviewedBy: input.reviewedBy,
      reviewerName: input.reviewerName,
      reviewerEmail: input.reviewerEmail,
      reviewComments: input.comments,
    },
  });
  if (input.markups.length > 0) {
    await tx.submittalFile.createMany({
      data: input.markups.map((file) => ({
        tenantId: input.tenantId,
        revisionId: input.revision.id,
        role: 'markup',
        ...file,
        uploadedBy: input.reviewedBy,
      })),
    });
  }
  await tx.submittal.update({ where: { id: input.submittal.id }, data: { status: input.outcome } });

  const managers = await tx.user.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      role: 'project_manager',
      projectMemberships: { some: { projectId: input.submittal.projectId } },
    },
    select: { id: true },
  });
  const recipients = new Set([
    input.submittal.createdBy,
    ...(input.revision.submittedBy ? [input.revision.submittedBy] : []),
    ...managers.map((user) => user.id),
  ]);
  if (input.reviewedBy) recipients.delete(input.reviewedBy);
  return {
    submittalId: input.submittal.id,
    projectId: input.submittal.projectId,
    projectName: input.submittal.project.name,
    label: submittalLabel(input.submittal.number, input.revision.revision),
    title: input.submittal.title,
    outcome: input.outcome,
    recipients: [...recipients],
  };
}
