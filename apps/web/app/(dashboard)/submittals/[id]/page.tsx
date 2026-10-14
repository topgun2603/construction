import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { SUBMITTAL_TYPE_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { emailsAbout, m365Status } from '@/lib/m365-status';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { rfiDocuments } from '@/lib/rfi-form-data';
import type { SubmittalDetail } from '@/lib/rfi-types';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { submittalBadge } from '../../rfis/labels';
import { SubmittalView } from './submittal-view';

export const metadata = { title: 'Submittal · BUILDR' };

/** One submittal: what it is, who prepared and reviews it, and every revision. */
export default async function SubmittalPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let submittal: SubmittalDetail;
  try {
    submittal = await serverFetch<SubmittalDetail>(`/submittals/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canManage = me.permissions.includes('submittals.manage');
  const current = submittal.revisions.find((revision) => revision.revision === submittal.current_revision);
  const documents = canManage && current?.status === 'draft' ? await rfiDocuments(me.permissions) : [];
  // Whether "Send by email" is on offer, and what has been emailed about this submittal already.
  const [m365, emails] = await Promise.all([
    canManage && submittal.reviewer.kind === 'external' ? m365Status() : Promise.resolve({ connected: false, mailbox: null }),
    emailsAbout(`/submittals/${id}/emails`),
  ]);
  const badge = submittalBadge(submittal);
  const reviewer =
    submittal.reviewer.kind === 'client'
      ? t('The client, in their approvals')
      : [submittal.reviewer.name, submittal.reviewer.company].filter(Boolean).join(', ') || '—';

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Link href="/submittals" className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline">
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Submittals')}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[13px] text-ink-muted" dir="ltr">
              {submittal.label}
            </span>
            <h2 className="text-[21px] font-semibold leading-tight">{submittal.title}</h2>
            <Badge tone={badge.tone}>{t(badge.label)}</Badge>
          </div>
          <Link href={`/projects/${submittal.project.id}?tab=design`} className="text-[13px] text-ink-muted hover:underline">
            {submittal.project.name}
          </Link>
        </div>
        <Link
          href={`/submittals/${submittal.id}/print`}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline"
        >
          <Printer className="size-3.5" /> {t('Print transmittal')}
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <SubmittalView
          submittal={submittal}
          documents={documents}
          canManage={canManage}
          canReview={me.permissions.includes('submittals.review')}
          m365Connected={m365.connected}
          emails={emails}
        />
        <Card className="flex h-fit flex-col gap-3 p-4">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-ink-muted">{t('Type')}</dt>
            <dd>{t(SUBMITTAL_TYPE_LABELS[submittal.type])}</dd>
            <dt className="text-ink-muted">{t('Spec section')}</dt>
            <dd dir="ltr" className="text-start">
              {submittal.spec_section ?? '—'}
            </dd>
            <dt className="text-ink-muted">{t('Cost code')}</dt>
            <dd>{submittal.cost_code ? `${submittal.cost_code.code} ${submittal.cost_code.name}` : '—'}</dd>
            <dt className="text-ink-muted">{t('Prepared by')}</dt>
            <dd>{submittal.submitted_by ?? t('Our own team')}</dd>
            <dt className="text-ink-muted">{t('Reviewer')}</dt>
            <dd>
              {reviewer}
              {submittal.reviewer.email && (
                <span className="block text-ink-muted" dir="ltr">
                  {submittal.reviewer.email}
                </span>
              )}
            </dd>
            <dt className="text-ink-muted">{t('Due')}</dt>
            <dd className={submittal.overdue ? 'font-semibold text-blocked-fg' : undefined}>
              {submittal.due_on ? shortDate(submittal.due_on) : '—'}
            </dd>
            <dt className="text-ink-muted">{t('Started by')}</dt>
            <dd>{submittal.created_by?.name ?? '—'}</dd>
          </dl>
          {submittal.description && <p className="whitespace-pre-line text-[13px]">{submittal.description}</p>}
        </Card>
      </div>
    </FadeIn>
  );
}
