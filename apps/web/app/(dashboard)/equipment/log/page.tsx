import Link from 'next/link';
import { ArrowLeft, Truck } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import type { Material, Page, Worker } from '@/lib/api-types';
import type { EquipmentSummary } from '@/lib/equipment-types';
import { FadeIn } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { DailyLogForm } from '../daily-log-form';

export const metadata = { title: 'Log equipment · BUILDR' };

/**
 * The daily log on its own page, so a supervisor can keep it open on a phone and log each machine
 * on the site at the end of the shift. `?site=` narrows it to one site's machines, `?machine=` to one.
 */
export default async function EquipmentLogPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; machine?: string }>;
}) {
  const t = await getT();
  const me = await requireSelf();
  const params = await searchParams;
  const can = (permission: string) => me.permissions.includes(permission);
  const allowed = can('equipment.log') || can('equipment.manage');

  if (!allowed) {
    return (
      <FadeIn className="flex flex-col gap-5">
        <h2 className="text-[21px] font-semibold leading-tight">{t('Log equipment')}</h2>
        <EmptyState icon={<Truck />} title={t('Not available')} body={t('Logging machines needs the equipment log permission.')} />
      </FadeIn>
    );
  }

  const [register, workers, materials] = await Promise.all([
    serverFetch<{ items: EquipmentSummary[] }>(
      `/equipment${params.site ? `?project_id=${encodeURIComponent(params.site)}` : ''}`,
    ),
    can('workers.view')
      ? serverFetch<Page<Worker>>('/workers?limit=500&status=active').catch(() => null)
      : Promise.resolve(null),
    can('materials.manage') || can('indents.raise')
      ? serverFetch<Page<Material>>('/materials?limit=500').catch(() => null)
      : Promise.resolve(null),
  ]);
  const machines = register.items
    .filter((row) => row.current_site && (!params.machine || row.id === params.machine))
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      meter_type: row.meter_type,
      meter_reading: row.meter_reading,
      fuel_included: row.fuel_included,
      site: row.current_site ? row.current_site.project : null,
    }));

  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/equipment" className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t('Equipment')}
        </Link>
        <h2 className="text-[21px] font-semibold leading-tight">{t('Log a machine’s day')}</h2>
        <p className="text-[13.5px] text-ink-muted">
          {t('Meter, hours, operator and fuel. The site is wherever the machine is allocated that day.')}
        </p>
      </div>
      {machines.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title={t('No machines on site')}
          body={t('A machine has to be allocated to a site before it can be logged.')}
        />
      ) : (
        <Card className="p-4">
          <DailyLogForm
            machines={machines}
            workers={(workers?.items ?? []).map((worker) => ({ id: worker.id, name: worker.name }))}
            materials={(materials?.items ?? []).map((material) => ({ id: material.id, name: material.name, unit: material.unit }))}
            fixedMachineId={params.machine && machines.length === 1 ? machines[0]!.id : undefined}
            canRecordExpense={can('expenses.record')}
          />
        </Card>
      )}
    </FadeIn>
  );
}
