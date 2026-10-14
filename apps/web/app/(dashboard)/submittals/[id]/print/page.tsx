import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SUBMITTAL_OUTCOMES, SUBMITTAL_STATUS_LABELS, SUBMITTAL_TYPE_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SubmittalDetail } from '@/lib/rfi-types';
import { PrintButton } from '../../../safety/print-button';

export const metadata = { title: 'Transmittal · Print · BUILDR' };

/**
 * The transmittal sheet that goes with the current revision: what is being sent, to whom, for what
 * action, and a box for the reviewer's stamp — with the outcome filled in once it has come back.
 */
export default async function PrintTransmittalPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { shortDate, instantDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let submittal: SubmittalDetail;
  try {
    submittal = await serverFetch<SubmittalDetail>(`/submittals/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const revision = submittal.revisions.find((row) => row.revision === submittal.current_revision)!;
  const reviewer =
    submittal.reviewer.kind === 'client'
      ? t('Client')
      : [submittal.reviewer.name, submittal.reviewer.company].filter(Boolean).join(', ') || '—';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          href={`/submittals/${submittal.id}`}
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {submittal.label}
        </Link>
        <PrintButton />
      </div>

      <article className="flex flex-col gap-6 rounded-panel border border-line bg-surface p-8 text-[13px] print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-[20px] font-semibold">{me.tenant.name}</span>
            <span className="text-ink-muted">{t('Submittal transmittal')}</span>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <dt className="text-ink-muted">{t('Number')}</dt>
            <dd className="font-mono font-semibold" dir="ltr">
              {revision.label}
            </dd>
            <dt className="text-ink-muted">{t('Date sent')}</dt>
            <dd>{revision.submitted_at ? instantDate(revision.submitted_at) : '—'}</dd>
            <dt className="text-ink-muted">{t('Review by')}</dt>
            <dd className="font-semibold">{revision.due_on ? shortDate(revision.due_on) : '—'}</dd>
          </dl>
        </header>

        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-muted">{t('Project')}</dt>
          <dd>{submittal.project.name}</dd>
          <dt className="text-ink-muted">{t('To')}</dt>
          <dd>{reviewer}</dd>
          <dt className="text-ink-muted">{t('Prepared by')}</dt>
          <dd>{submittal.submitted_by ?? me.tenant.name}</dd>
          <dt className="text-ink-muted">{t('Title')}</dt>
          <dd className="font-semibold">{submittal.title}</dd>
          <dt className="text-ink-muted">{t('Type')}</dt>
          <dd>{t(SUBMITTAL_TYPE_LABELS[submittal.type])}</dd>
          <dt className="text-ink-muted">{t('Spec section')}</dt>
          <dd>{submittal.spec_section ?? '—'}</dd>
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Enclosed')}</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="w-10 py-1 text-start font-medium">#</th>
                <th className="py-1 text-start font-medium">{t('Document')}</th>
              </tr>
            </thead>
            <tbody>
              {revision.files.map((file, index) => (
                <tr key={file.id} className="border-b border-line">
                  <td className="py-2 font-mono">{index + 1}</td>
                  <td className="py-2">{file.filename}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {revision.note && <p className="whitespace-pre-line">{revision.note}</p>}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Review')}</h3>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {SUBMITTAL_OUTCOMES.map((outcome) => (
              <li key={outcome} className="flex items-center gap-2">
                <span className="font-mono">{revision.status === outcome ? '[x]' : '[ ]'}</span>
                {t(SUBMITTAL_STATUS_LABELS[outcome])}
              </li>
            ))}
          </ul>
          {revision.review_comments ? (
            <p className="whitespace-pre-line rounded-btn border border-line p-3">{revision.review_comments}</p>
          ) : (
            <div className="h-32 rounded-btn border border-line" />
          )}
          {revision.reviewed_at && (
            <p className="text-ink-muted">
              {revision.reviewer_name ?? '—'} · {instantDate(revision.reviewed_at)}
            </p>
          )}
        </section>

        <footer className="grid grid-cols-2 gap-8 pt-6">
          <div className="border-t border-line-strong pt-1 text-ink-muted">{t('Sent by (signature)')}</div>
          <div className="border-t border-line-strong pt-1 text-ink-muted">{t('Reviewer (signature and stamp)')}</div>
        </footer>
      </article>
    </div>
  );
}
