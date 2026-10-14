import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { SAFETY_PERMIT_TYPE_LABELS } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { SafetyPermitDetail } from '@/lib/safety-types';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { permitBadge } from '../../labels';
import { PhotoStrip } from '../../photo-strip';
import { PermitChecklist, PermitSteps } from './permit-controls';

export const metadata = { title: 'Permit to work · Safety · BUILDR' };

/** One permit to work: the job, the window, the crew, the checklist and the two signatures. */
export default async function PermitPage({ params }: { params: Promise<{ id: string }> }) {
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
  const canManage = me.permissions.includes('safety.manage');
  const requester = permit.requested_by?.id === me.user.id;
  const badge = permitBadge(permit);
  const when = (iso: string | null) => (iso ? `${instantDate(iso)}, ${timeOfDay(iso)}` : '—');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link href="/safety?tab=permits" className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline">
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Permits to work')}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[21px] font-semibold leading-tight">{t(SAFETY_PERMIT_TYPE_LABELS[permit.type])}</h2>
            <Badge tone={badge.tone}>{t(badge.label)}</Badge>
          </div>
          <span className="text-[13px] text-ink-muted">
            <span className="font-mono" dir="ltr">
              {permit.number}
            </span>{' '}
            · {permit.description} · {permit.area} ·{' '}
            <Link href={`/projects/${permit.project.id}?tab=safety`} className="hover:underline">
              {permit.project.name}
            </Link>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PermitSteps permit={permit} canManage={canManage} meId={me.user.id} />
          <Link
            href={`/safety/permits/${permit.id}/print`}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-line-strong bg-surface px-3 text-[13px] font-semibold hover:bg-raised"
          >
            <Printer className="size-4" /> {t('Print')}
          </Link>
        </div>
      </div>

      {permit.expired && (
        <p className="rounded-btn border border-blocked/40 bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
          {t('This permit’s time has run out. Stop the work, then close it or raise a new one.')}
        </p>
      )}
      {permit.status === 'suspended' && permit.suspended_reason && (
        <p className="rounded-btn border border-blocked/40 bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
          {t('Suspended')}: {permit.suspended_reason}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2 p-4 text-[13.5px]">
            <h3 className="text-[14px] font-semibold">{t('The permit')}</h3>
            <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-ink-muted">{t('Valid from')}</dt>
              <dd>{when(permit.valid_from)}</dd>
              <dt className="text-ink-muted">{t('Valid to')}</dt>
              <dd>{when(permit.valid_to)}</dd>
              <dt className="text-ink-muted">{t('Requested by')}</dt>
              <dd>{permit.requested_by?.name ?? '—'}</dd>
              <dt className="text-ink-muted">{t('Issuer')}</dt>
              <dd>{permit.issuer ? `${permit.issuer.name} · ${when(permit.issued_at)}` : t('Not signed')}</dd>
              <dt className="text-ink-muted">{t('Area authority')}</dt>
              <dd>
                {permit.area_authority
                  ? `${permit.area_authority.name} · ${when(permit.area_authority_at)}`
                  : t('Not signed')}
              </dd>
              <dt className="text-ink-muted">{t('Precautions')}</dt>
              <dd className="whitespace-pre-line">{permit.precautions ?? '—'}</dd>
              {permit.closed_at && (
                <>
                  <dt className="text-ink-muted">{t('Closed')}</dt>
                  <dd>
                    {permit.closed_by?.name} · {when(permit.closed_at)}
                    {permit.close_note && ` — ${permit.close_note}`}
                  </dd>
                </>
              )}
            </dl>
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <h3 className="text-[14px] font-semibold">
              {t('Crew')} ({permit.crew.length})
            </h3>
            {permit.crew.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('No crew named.')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-[13px]">
                {permit.crew.map((member) => (
                  <li key={member.worker_id} className="rounded-full bg-raised px-2.5 py-1">
                    {member.name}
                    {member.trade && <span className="text-ink-muted"> · {member.trade}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <PermitChecklist permit={permit} canEdit={permit.status === 'requested' && (canManage || requester)} />
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Photos')}</h3>
            <PhotoStrip
              photos={permit.photos}
              projectId={permit.project.id}
              parent={{ permit_id: permit.id }}
              canAdd={me.permissions.includes('safety.report') && permit.status !== 'closed'}
            />
          </Card>
        </div>
      </div>
    </FadeIn>
  );
}
