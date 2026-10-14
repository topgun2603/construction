import { Bus, Tent } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import type { CampDay, Page, Worker } from '@/lib/api-types';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { AddCampDialog, CampResidentsButton } from './camp-controls';

export const metadata = { title: 'Camps · BUILDR' };

/**
 * Labour camps (roadmap Phase 1, item 4).
 *
 * For each camp: who lives there, how many went to work today, and to which site — read straight
 * off the roll call, so the bus loads are known without a transport log anybody has to keep.
 */
export default async function CampsPage() {
  const t = await getT();
  const { longDate } = await getFormat();
  const [day, workers, me] = await Promise.all([
    serverFetch<CampDay>('/camps'),
    serverFetch<Page<Worker>>('/workers?limit=500'),
    requireSelf(),
  ]);
  const canManage = me.permissions.includes('workers.manage');

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Camps')}</h2>
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            {t(
              'Where your crews live, and how many from each camp went to each site — the seats each bus needs. Counted from the roll call for',
            )}{' '}
            {longDate(day.date)}.
          </p>
        </div>
        {canManage && <AddCampDialog />}
      </div>

      {day.camps.length === 0 ? (
        <EmptyState
          icon={<Tent />}
          title={t('No camps yet')}
          body={t('Add the camps your workers live in, then move workers into them.')}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {day.camps.map((camp) => (
            <Card key={camp.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{camp.name}</span>
                  {camp.address && (
                    <span className="text-[12.5px] text-ink-muted">{camp.address}</span>
                  )}
                </div>
                <CampResidentsButton
                  campId={camp.id}
                  campName={camp.name}
                  workers={workers.items}
                  canManage={canManage}
                />
              </div>

              <div className="flex gap-6">
                <Figure
                  label={t('Living here')}
                  value={
                    camp.capacity ? `${camp.residents} / ${camp.capacity}` : String(camp.residents)
                  }
                />
                <Figure label={t('On site today')} value={String(camp.on_site)} />
              </div>

              {camp.by_site.length > 0 && (
                <ul className="flex flex-col gap-1 border-t border-line-soft pt-2.5">
                  {camp.by_site.map((site) => (
                    <li key={site.project_id} className="flex justify-between text-[13px]">
                      <span>{site.project_name}</span>
                      <span className="font-mono text-ink-muted">{site.count}</span>
                    </li>
                  ))}
                </ul>
              )}

              {camp.transport_note && (
                <span className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                  <Bus className="size-3.5" /> {camp.transport_note}
                </span>
              )}
            </Card>
          ))}
        </div>
      )}

      {day.unhoused_on_site > 0 && (
        <p className="text-[13px] text-ink-muted">
          {day.unhoused_on_site}{' '}
          {t('on site today live in no camp — local hires, or workers not yet housed.')}
        </p>
      )}
    </FadeIn>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </span>
      <span className="font-mono text-[18px] font-semibold">{value}</span>
    </div>
  );
}
