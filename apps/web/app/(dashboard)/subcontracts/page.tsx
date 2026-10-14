import { HardHat } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { Contractor, Page, ProjectSummary } from '@/lib/api-types';
import type { SubcontractSummary } from '@/lib/subcontract-types';
import { FadeIn } from '@/components/motion';
import { ExportMenu } from '@/components/export-menu';
import { StatTile } from '@/components/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { NewSubcontractDialog } from './new-subcontract-dialog';
import { SubcontractsTable } from './subcontracts-table';

export const metadata = { title: 'Subcontracts · BUILDR' };

/**
 * Every subcontract the caller can see, across their sites (roadmap Phase 2, module 3).
 *
 * The tiles answer what an owner opens this page to ask: what has been let, what is owed now, and
 * whether a bill is waiting on somebody to certify it.
 */
export default async function SubcontractsPage() {
  const t = await getT();
  const { money, moneyShort } = await getFormat();
  const me = await requireSelf();
  const canManage = me.permissions.includes('subcontracts.manage');
  const showMoney = me.permissions.includes('subcontracts.view');

  const [list, sites, contractors] = await Promise.all([
    serverFetch<{ items: SubcontractSummary[] }>('/subcontracts'),
    canManage ? serverFetch<Page<ProjectSummary>>('/projects?limit=200') : null,
    // Contractors live behind the labour module; without it there is nobody to pick yet.
    canManage
      ? serverFetch<Page<Contractor>>('/contractors?limit=200').catch(() => null)
      : null,
  ]);
  const items = list.items;
  const running = items.filter((row) => row.status === 'active' || row.status === 'completed');
  const sum = (pick: (row: SubcontractSummary) => string | null) =>
    running.reduce((total, row) => total + BigInt(pick(row) ?? '0'), 0n).toString();
  const waiting = items.filter((row) => row.open_bill?.status === 'submitted').length;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Subcontracts')}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Work let to subcontractors, their running bills, retention and what is owed.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu kind="subcontracts" />
          {canManage && (
            <NewSubcontractDialog
              sites={(sites?.items ?? []).map((site) => ({ id: site.id, name: site.name }))}
              contractors={contractors?.items ?? []}
            />
          )}
        </div>
      </div>

      {showMoney && items.length > 0 && (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t('Let and running')}
            value={moneyShort(sum((row) => row.current_value))}
            note={`${running.length} ${t('subcontracts')}`}
          />
          <StatTile label={t('Certified to date')} value={moneyShort(sum((row) => row.certified))} />
          <StatTile
            label={t('Owed now')}
            value={money(sum((row) => row.balance_due))}
            noteTone="pending"
            note={t('Certified bills and released retention not yet paid')}
          />
          <StatTile
            label={t('Bills to certify')}
            value={String(waiting)}
            animate
            noteTone={waiting > 0 ? 'pending' : 'done'}
            note={waiting > 0 ? t('Waiting on a certifier') : t('Nothing waiting')}
          />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<HardHat />}
          title={t('No subcontracts yet')}
          body={t(
            'Let a scope of work — plaster, waterproofing, MEP — to a subcontractor at agreed rates, then bill it month by month as the work is measured.',
          )}
        />
      ) : (
        <SubcontractsTable subcontracts={items} />
      )}
    </FadeIn>
  );
}
