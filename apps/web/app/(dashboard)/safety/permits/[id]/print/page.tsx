import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SAFETY_PERMIT_TYPE_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SafetyPermitDetail } from '@/lib/safety-types';
import { permitBadge } from '../../../labels';
import { PrintButton } from '../../../print-button';

export const metadata = { title: 'Permit to work · Print · BUILDR' };

/**
 * The permit as it is posted at the work point: the job, the window, the crew, the ticked checks
 * and the signatures. A permit that is not yet active says so across the top, so a printed copy of a
 * request is never mistaken for permission.
 */
export default async function PrintPermitPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { instantDate, timeOfDay } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let permit: SafetyPermitDetail;
  try {
    permit = await serverFetch<SafetyPermitDetail>(`/safety/permits/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const when = (iso: string | null) => (iso ? `${instantDate(iso)}, ${timeOfDay(iso)}` : '');
  const valid = permit.status === 'active' && !permit.expired;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          href={`/safety/permits/${permit.id}`}
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {permit.number}
        </Link>
        <PrintButton />
      </div>

      <article className="flex flex-col gap-6 rounded-panel border border-line bg-surface p-8 text-[13px] print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-[20px] font-semibold">{me.tenant.name}</span>
            <span className="text-ink-muted">
              {t('Permit to work')} — {t(SAFETY_PERMIT_TYPE_LABELS[permit.type])}
            </span>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <dt className="text-ink-muted">{t('Number')}</dt>
            <dd className="font-mono font-semibold" dir="ltr">
              {permit.number}
            </dd>
            <dt className="text-ink-muted">{t('Status')}</dt>
            <dd>{t(permitBadge(permit).label)}</dd>
          </dl>
        </header>

        {!valid && (
          <p className="rounded-btn border border-line-strong px-3 py-2 font-semibold">
            {t('NOT VALID — this permit is not active. Do not start work against this copy.')}
          </p>
        )}

        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-muted">{t('Site')}</dt>
          <dd>{permit.project.name}</dd>
          <dt className="text-ink-muted">{t('Area')}</dt>
          <dd>{permit.area}</dd>
          <dt className="text-ink-muted">{t('The work')}</dt>
          <dd>{permit.description}</dd>
          <dt className="text-ink-muted">{t('Valid from')}</dt>
          <dd>{when(permit.valid_from)}</dd>
          <dt className="text-ink-muted">{t('Valid to')}</dt>
          <dd className="font-semibold">{when(permit.valid_to)}</dd>
          <dt className="text-ink-muted">{t('Precautions')}</dt>
          <dd className="whitespace-pre-line">{permit.precautions ?? '—'}</dd>
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Checklist')}</h3>
          <ul className="flex flex-col gap-1">
            {permit.checklist.map((item) => (
              <li key={item.item} className="flex items-start gap-2">
                <span className="font-mono">{item.checked ? '[x]' : '[ ]'}</span>
                {t(item.item)}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Crew')}</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-1 text-start font-medium">{t('Name')}</th>
                <th className="py-1 text-start font-medium">{t('Trade')}</th>
                <th className="w-40 py-1 text-start font-medium">{t('Signature')}</th>
              </tr>
            </thead>
            <tbody>
              {permit.crew.map((member) => (
                <tr key={member.worker_id} className="border-b border-line">
                  <td className="py-2">{member.name}</td>
                  <td className="py-2">{member.trade ?? ''}</td>
                  <td className="py-2" />
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="mt-4 grid gap-10 sm:grid-cols-3">
          {[
            { label: t('Requested by'), name: permit.requested_by?.name, at: '' },
            { label: t('Issuer'), name: permit.issuer?.name, at: when(permit.issued_at) },
            { label: t('Area authority'), name: permit.area_authority?.name, at: when(permit.area_authority_at) },
          ].map((sign) => (
            <div key={sign.label} className="flex flex-col gap-0.5 border-t border-ink pt-1.5">
              <span className="text-ink-muted">{sign.label}</span>
              <span>{sign.name ?? ''}</span>
              <span className="text-ink-muted">{sign.at}</span>
            </div>
          ))}
        </footer>
      </article>
    </div>
  );
}
