import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, Printer } from 'lucide-react';
import { RFI_DISCIPLINE_LABELS, RFI_PRIORITY_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { TeamMember } from '@/lib/api-types';
import { rfiDocuments } from '@/lib/rfi-form-data';
import type { RfiDetail } from '@/lib/rfi-types';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { rfiBadge } from '../labels';
import { ChangeOrderLink, FileList, RfiView } from './rfi-view';

export const metadata = { title: 'RFI · BUILDR' };

/** One RFI: the question, who it went to, the drawings it is about, and the thread of answers. */
export default async function RfiPage({ params }: { params: Promise<{ id: string }> }) {
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
  const canManage = me.permissions.includes('rfis.manage');
  const live = rfi.status !== 'closed' && rfi.status !== 'void';
  // The owner on the team is picked from the team list, which only some roles may read.
  const canListTeam = ['team.manage', 'projects.manage', 'wages.view', 'audit.view'].some((p) =>
    me.permissions.includes(p),
  );
  const [team, documents] =
    canManage && live
      ? await Promise.all([
          canListTeam
            ? serverFetch<TeamMember[]>('/tenants/current/team').catch(() => [] as TeamMember[])
            : Promise.resolve([] as TeamMember[]),
          rfiDocuments(me.permissions),
        ])
      : [[] as TeamMember[], []];
  const people = team
    .filter((person) => person.role !== 'client' && person.status === 'active')
    .map((person) => ({ id: person.id, name: person.name }));
  const badge = rfiBadge(rfi);
  const party = [rfi.addressed_to.name, rfi.addressed_to.company].filter(Boolean).join(', ');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Link href="/rfis" className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline">
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('RFIs')}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[13px] text-ink-muted" dir="ltr">
              {rfi.label}
            </span>
            <h2 className="text-[21px] font-semibold leading-tight">{rfi.subject}</h2>
            <Badge tone={badge.tone}>{t(badge.label)}</Badge>
          </div>
          <Link href={`/projects/${rfi.project.id}?tab=design`} className="text-[13px] text-ink-muted hover:underline">
            {rfi.project.name}
          </Link>
        </div>
        <Link
          href={`/rfis/${rfi.id}/print`}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline"
        >
          <Printer className="size-3.5" /> {t('Print RFI')}
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Question')}</h3>
            <p className="whitespace-pre-line text-[14px]">{rfi.question}</p>
            {rfi.documents.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {t('Drawings')}
                </span>
                <ul className="flex flex-wrap gap-2">
                  {rfi.documents.map((document) => (
                    <li key={document.id}>
                      <a
                        href={document.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-btn border border-line px-2 py-1 text-[12.5px] hover:bg-raised"
                      >
                        <FileText className="size-3.5" />
                        {document.title}
                        <span className="font-mono text-ink-faint" dir="ltr">
                          v{document.version}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <FileList files={rfi.attachments} />
          </Card>
          <RfiView
            rfi={rfi}
            canManage={canManage}
            canRaiseChangeOrder={canManage && me.permissions.includes('change_orders.manage')}
            people={people}
            documents={documents}
          />
        </div>

        <Card className="flex h-fit flex-col gap-3 p-4">
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-ink-muted">{t('Addressed to')}</dt>
            <dd>
              {party || '—'}
              {rfi.addressed_to.email && (
                <span className="block text-ink-muted" dir="ltr">
                  {rfi.addressed_to.email}
                </span>
              )}
            </dd>
            <dt className="text-ink-muted">{t('Discipline')}</dt>
            <dd>{t(RFI_DISCIPLINE_LABELS[rfi.discipline])}</dd>
            <dt className="text-ink-muted">{t('Priority')}</dt>
            <dd>{t(RFI_PRIORITY_LABELS[rfi.priority])}</dd>
            <dt className="text-ink-muted">{t('Location')}</dt>
            <dd>{rfi.location ?? '—'}</dd>
            <dt className="text-ink-muted">{t('Raised by')}</dt>
            <dd>
              {rfi.raised_by?.name ?? '—'}, {shortDate(rfi.raised_on)}
            </dd>
            <dt className="text-ink-muted">{t('Owner on the team')}</dt>
            <dd>{rfi.assignee?.name ?? '—'}</dd>
            <dt className="text-ink-muted">{t('Sent')}</dt>
            <dd>{rfi.sent_at ? instantDate(rfi.sent_at) : '—'}</dd>
            <dt className="text-ink-muted">{t('Due')}</dt>
            <dd className={rfi.overdue ? 'font-semibold text-blocked-fg' : undefined}>
              {rfi.due_on ? shortDate(rfi.due_on) : '—'}
            </dd>
            <dt className="text-ink-muted">{t('Answered')}</dt>
            <dd>
              {rfi.answered_at ? instantDate(rfi.answered_at) : '—'}
              {rfi.response_days !== null && (
                <span className="text-ink-muted">
                  {' '}
                  · {rfi.response_days} {t('days')}
                </span>
              )}
            </dd>
            <dt className="text-ink-muted">{t('Impact')}</dt>
            <dd>
              {[rfi.cost_impact ? t('Cost') : null, rfi.schedule_impact ? t('Schedule') : null]
                .filter(Boolean)
                .join(' · ') || t('None flagged')}
            </dd>
            <dt className="text-ink-muted">{t('Change order')}</dt>
            <dd>
              <ChangeOrderLink changeOrder={rfi.change_order} />
            </dd>
            {rfi.schedule_task && (
              <>
                <dt className="text-ink-muted">{t('Schedule task')}</dt>
                <dd>{rfi.schedule_task.name}</dd>
              </>
            )}
            {rfi.status === 'closed' && (
              <>
                <dt className="text-ink-muted">{t('Closed')}</dt>
                <dd>
                  {rfi.closed_by?.name ?? '—'}
                  {rfi.closed_at ? `, ${instantDate(rfi.closed_at)}` : ''}
                  {rfi.close_note && <span className="block text-ink-muted">{rfi.close_note}</span>}
                </dd>
              </>
            )}
            {rfi.status === 'void' && (
              <>
                <dt className="text-ink-muted">{t('Void')}</dt>
                <dd>{rfi.void_reason}</dd>
              </>
            )}
          </dl>
        </Card>
      </div>
    </FadeIn>
  );
}
