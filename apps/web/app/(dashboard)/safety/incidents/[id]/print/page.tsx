import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SAFETY_INCIDENT_TYPE_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SafetyIncidentDetail } from '@/lib/safety-types';
import { ACTION_STATUS, INCIDENT_STATUS, PERSON_ROLE, SEVERITY } from '../../../labels';
import { PrintButton } from '../../../print-button';

export const metadata = { title: 'Incident report · Print · BUILDR' };

/**
 * The incident report as it goes to an insurer, a client's HSE team or an inspector: printed or
 * saved as a PDF from the browser. Plain on purpose, like the purchase order — the global print
 * rules drop the app's chrome — with signature lines for the investigator and the manager.
 */
export default async function PrintIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { instantDate, timeOfDay, shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let incident: SafetyIncidentDetail;
  try {
    incident = await serverFetch<SafetyIncidentDetail>(`/safety/incidents/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const row = (label: string, value: string | null | undefined) => (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd>{value || '—'}</dd>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          href={`/safety/incidents/${incident.id}`}
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" /> {incident.number}
        </Link>
        <PrintButton />
      </div>

      <article className="flex flex-col gap-6 rounded-panel border border-line bg-surface p-8 text-[13px] print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-[20px] font-semibold">{me.tenant.name}</span>
            <span className="text-ink-muted">{t('Incident report')}</span>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <dt className="text-ink-muted">{t('Number')}</dt>
            <dd className="font-mono font-semibold" dir="ltr">
              {incident.number}
            </dd>
            <dt className="text-ink-muted">{t('Status')}</dt>
            <dd>{t(INCIDENT_STATUS[incident.status].label)}</dd>
          </dl>
        </header>

        <section className="grid gap-x-6 gap-y-1">
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5">
            {row(t('Site'), incident.project.name)}
            {row(t('When'), `${instantDate(incident.occurred_at)}, ${timeOfDay(incident.occurred_at)}`)}
            {row(t('Where'), incident.location)}
            {row(t('Type'), t(SAFETY_INCIDENT_TYPE_LABELS[incident.type]))}
            {row(t('Severity'), t(SEVERITY[incident.severity].label))}
            {row(t('What happened'), incident.title)}
            {row(t('Details'), incident.description)}
            {row(t('Done on the spot'), incident.immediate_action)}
            {row(t('Working days lost'), incident.lost_days === null ? null : String(incident.lost_days))}
            {row(t('Reported by'), incident.reported_by?.name)}
          </dl>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('People')}</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-1 text-start font-medium">{t('Name')}</th>
                <th className="py-1 text-start font-medium">{t('Role')}</th>
                <th className="py-1 text-start font-medium">{t('Injury')}</th>
                <th className="py-1 text-start font-medium">{t('Statement')}</th>
              </tr>
            </thead>
            <tbody>
              {incident.people.map((person) => (
                <tr key={person.id} className="border-b border-line align-top">
                  <td className="py-1.5">{person.name}</td>
                  <td className="py-1.5">{t(PERSON_ROLE[person.role])}</td>
                  <td className="py-1.5">{[person.body_part, person.injury_nature].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="py-1.5">{person.statement ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Root cause')}</h3>
          <ol className="flex list-decimal flex-col gap-0.5 ps-5">
            {incident.root_cause_whys.map((why, index) => (
              <li key={index}>{why}</li>
            ))}
          </ol>
          <p>{incident.root_cause ?? '—'}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('Corrective and preventive actions')}</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-1 text-start font-medium">{t('Action')}</th>
                <th className="py-1 text-start font-medium">{t('Assigned to')}</th>
                <th className="py-1 text-start font-medium">{t('Due')}</th>
                <th className="py-1 text-start font-medium">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {incident.actions.map((action) => (
                <tr key={action.id} className="border-b border-line align-top">
                  <td className="py-1.5">{action.description}</td>
                  <td className="py-1.5">{action.assignee?.name ?? '—'}</td>
                  <td className="py-1.5">{action.due_on ? shortDate(action.due_on) : '—'}</td>
                  <td className="py-1.5">{t(ACTION_STATUS[action.status].label)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {incident.closed_at && (
          <p>
            {t('Closed by')} {incident.closed_by?.name ?? '—'}, {instantDate(incident.closed_at)}
            {incident.closure_note ? ` — ${incident.closure_note}` : ''}
          </p>
        )}

        <footer className="mt-6 grid gap-10 sm:grid-cols-2">
          {[t('Investigated by'), t('Approved by')].map((label) => (
            <div key={label} className="flex flex-col gap-1 border-t border-ink pt-1.5 text-ink-muted">
              {label}
            </div>
          ))}
        </footer>
      </article>
    </div>
  );
}
