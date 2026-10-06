import Link from 'next/link';
import { ClipboardList, Truck } from 'lucide-react';
import { EQUIPMENT_CATEGORY_LABELS, type EquipmentCategory } from '@sitebook/shared';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { EquipmentCostReport, EquipmentLog, EquipmentSummary } from '@/lib/equipment-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * A site's equipment tab (roadmap Phase 2, module 10): the machines on it now, the latest logs, and —
 * for whoever sees cost — what equipment has cost the site over the last 30 days and how much of it
 * the cost report counts. Moving machines and the full history live on /equipment.
 */
export async function SiteEquipment({
  siteId,
  machines,
  logs,
  costs,
  canLog,
}: {
  siteId: string;
  machines: EquipmentSummary[];
  logs: EquipmentLog[];
  costs: EquipmentCostReport | null;
  canLog: boolean;
}) {
  const t = await getT();
  const { money, shortDate, todayIso } = await getFormat();
  const today = todayIso();
  const loggedToday = new Set(logs.filter((log) => log.log_date === today).map((log) => log.equipment.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-ink-muted">
          {machines.length} {t('machines on this site')}
          {costs ? ` · ${money(costs.totals.counted)} ${t('in the cost report, last 30 days')}` : ''}
        </p>
        <div className="flex gap-2">
          {canLog && machines.length > 0 && (
            <Button asChild size="sm">
              <Link href={`/equipment/log?site=${siteId}`}>
                <ClipboardList className="size-4" />
                {t('Log a day')}
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="secondary">
            <Link href="/equipment?tab=board">{t('All equipment')}</Link>
          </Button>
        </div>
      </div>

      {machines.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title={t('No machines on this site')}
          body={t('Allocate a machine to this site from its page under Equipment.')}
        />
      ) : (
        <Card className="p-0">
          <ul className="flex flex-col divide-y divide-line-soft">
            {machines.map((machine) => (
              <li key={machine.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
                <Link href={`/equipment/${machine.id}`} className="flex flex-col hover:underline">
                  <span className="font-medium">
                    {machine.name}{' '}
                    <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
                      {machine.code}
                    </span>
                  </span>
                  <span className="text-[12px] text-ink-muted">
                    {t(EQUIPMENT_CATEGORY_LABELS[machine.category as EquipmentCategory] ?? machine.category)} ·{' '}
                    {machine.ownership === 'hired' ? `${t('hired from')} ${machine.vendor?.name ?? ''}` : t('owned')} ·{' '}
                    {t('since')} {shortDate(machine.current_site?.since)}
                  </span>
                </Link>
                {loggedToday.has(machine.id) ? (
                  <Badge tone="done">{t('Logged today')}</Badge>
                ) : (
                  <Badge tone="pending">{t('Not logged today')}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {logs.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-[14px] font-semibold">{t('Recent logs')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[12px] text-ink-muted">
                  <th className="py-1.5 text-start font-medium">{t('Date')}</th>
                  <th className="py-1.5 text-start font-medium">{t('Machine')}</th>
                  <th className="py-1.5 text-end font-medium">{t('Worked')}</th>
                  <th className="py-1.5 text-end font-medium">{t('Idle')}</th>
                  <th className="py-1.5 text-end font-medium">{t('Breakdown')}</th>
                  <th className="py-1.5 text-end font-medium">{t('Fuel')}</th>
                  <th className="py-1.5 text-start font-medium">{t('Operator')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-line">
                    <td className="py-2 whitespace-nowrap">{shortDate(log.log_date)}</td>
                    <td className="py-2">
                      <span className="font-mono text-[12px]" dir="ltr">
                        {log.equipment.code}
                      </span>{' '}
                      {log.equipment.name}
                    </td>
                    <td className="py-2 text-end font-mono">{log.hours_worked}</td>
                    <td className="py-2 text-end font-mono">{log.idle_hours}</td>
                    <td className="py-2 text-end font-mono">{log.breakdown_hours}</td>
                    <td className="py-2 text-end font-mono">{log.fuel_litres ? `${log.fuel_litres} L` : '—'}</td>
                    <td className="py-2">{log.operator?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
