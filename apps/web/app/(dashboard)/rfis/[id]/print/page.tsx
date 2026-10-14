import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { RFI_DISCIPLINE_LABELS, RFI_PRIORITY_LABELS, RFI_STATUS_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { RfiDetail } from '@/lib/rfi-types';
import { PrintButton } from '../../../safety/print-button';

export const metadata = { title: 'RFI · Print · BUILDR' };

/**
 * The RFI as a sheet for the consultant's file or the site record: the question, the references, and
 * the official answer with who gave it and when. "Save as PDF" is the browser's print dialog.
 */
export default async function PrintRfiPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { shortDate, instantDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let rfi: RfiDetail;
  try {
    rfi = await serverFetch<RfiDetail>(`/rfis/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const official = rfi.responses.find((response) => response.is_official);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link href={`/rfis/${rfi.id}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline">
          <ArrowLeft className="size-3 rtl:rotate-180" /> {rfi.label}
        </Link>
        <PrintButton />
      </div>

      <article className="flex flex-col gap-6 rounded-panel border border-line bg-surface p-8 text-[13px] print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-[20px] font-semibold">{me.tenant.name}</span>
            <span className="text-ink-muted">{t('Request for information')}</span>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <dt className="text-ink-muted">{t('Number')}</dt>
            <dd className="font-mono font-semibold" dir="ltr">
              {rfi.label}
            </dd>
            <dt className="text-ink-muted">{t('Status')}</dt>
            <dd>{t(RFI_STATUS_LABELS[rfi.status])}</dd>
            <dt className="text-ink-muted">{t('Date')}</dt>
            <dd>{shortDate(rfi.raised_on)}</dd>
            <dt className="text-ink-muted">{t('Reply by')}</dt>
            <dd className="font-semibold">{rfi.due_on ? shortDate(rfi.due_on) : '—'}</dd>
          </dl>
        </header>

        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-muted">{t('Project')}</dt>
          <dd>{rfi.project.name}</dd>
          <dt className="text-ink-muted">{t('To')}</dt>
          <dd>{[rfi.addressed_to.name, rfi.addressed_to.company].filter(Boolean).join(', ') || '—'}</dd>
          <dt className="text-ink-muted">{t('From')}</dt>
          <dd>{rfi.raised_by?.name ?? '—'}</dd>
          <dt className="text-ink-muted">{t('Subject')}</dt>
          <dd className="font-semibold">{rfi.subject}</dd>
          <dt className="text-ink-muted">{t('Discipline')}</dt>
          <dd>
            {t(RFI_DISCIPLINE_LABELS[rfi.discipline])} · {t(RFI_PRIORITY_LABELS[rfi.priority])}
          </dd>
          <dt className="text-ink-muted">{t('Location')}</dt>
          <dd>{rfi.location ?? '—'}</dd>
          <dt className="text-ink-muted">{t('References')}</dt>
          <dd>
            {rfi.documents.length > 0
              ? rfi.documents.map((document) => `${document.title} (v${document.version})`).join('; ')
              : '—'}
          </dd>
          <dt className="text-ink-muted">{t('Impact')}</dt>
          <dd>
            {[rfi.cost_impact ? t('Cost') : null, rfi.schedule_impact ? t('Schedule') : null].filter(Boolean).join(' · ') ||
              t('None flagged')}
          </dd>
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Question')}</h3>
          <p className="whitespace-pre-line rounded-btn border border-line p-3">{rfi.question}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Answer')}</h3>
          {official ? (
            <>
              <p className="whitespace-pre-line rounded-btn border border-line p-3">{official.body}</p>
              <p className="text-ink-muted">
                {official.author.name} · {instantDate(official.created_at)}
              </p>
            </>
          ) : (
            <div className="h-40 rounded-btn border border-line" />
          )}
        </section>

        <footer className="grid grid-cols-2 gap-8 pt-6">
          <div className="border-t border-line-strong pt-1 text-ink-muted">{t('Raised by (signature)')}</div>
          <div className="border-t border-line-strong pt-1 text-ink-muted">{t('Answered by (signature)')}</div>
        </footer>
      </article>
    </div>
  );
}
