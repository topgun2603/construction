import Link from 'next/link';
import { ClipboardList, Download, Truck } from 'lucide-react';
import { EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_COST_KIND_LABELS, EQUIPMENT_DOCUMENT_LABELS, type EquipmentCategory, type EquipmentDocumentKind } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { Vendor } from '@/lib/procurement-types';
import type {
  EquipmentBoard,
  EquipmentCostReport,
  EquipmentDue,
  EquipmentFuelReport,
  EquipmentSummary,
  EquipmentUtilisationReport,
} from '@/lib/equipment-types';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EquipmentDialog } from './equipment-dialog';
import { HIRE_BASIS_LABEL, PAPERS, SERVICE, STATUS, utilisationTone } from './labels';

export const metadata = { title: 'Equipment · BUILDR' };

const TABS = ['register', 'board', 'maintenance', 'reports'] as const;
type TabKey = (typeof TABS)[number];

const COST_COLUMNS = ['hire', 'mobilisation', 'operator', 'charge_out', 'fuel', 'maintenance'] as const;

/**
 * Equipment and plant across the company (roadmap Phase 2, module 10): the register of owned and
 * hired machines, what is on each site today, servicing and papers falling due, and — for whoever
 * sees cost — utilisation, fuel and cost per site.
 */
export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const t = await getT();
  const { money, moneyShort, shortDate, todayIso } = await getFormat();
  const me = await requireSelf();
  const params = await searchParams;
  const can = (permission: string) => me.permissions.includes(permission);
  const canView = can('equipment.view');
  const canManage = can('equipment.manage');
  const canLog = can('equipment.log') || canManage;
  const tabs = TABS.filter((tab) => tab !== 'reports' || canView);
  const active: TabKey = (tabs as readonly string[]).includes(params.tab ?? '') ? (params.tab as TabKey) : 'register';
  const range = new URLSearchParams();
  if (params.from) range.set('from', params.from);
  if (params.to) range.set('to', params.to);

  const [register, board, due, vendors, costs, utilisation, fuel] = await Promise.all([
    serverFetch<{ items: EquipmentSummary[] }>('/equipment'),
    serverFetch<EquipmentBoard>('/equipment/board'),
    serverFetch<EquipmentDue>('/equipment/maintenance/due'),
    canManage ? serverFetch<Vendor[]>('/vendors?active=true').catch(() => [] as Vendor[]) : Promise.resolve([] as Vendor[]),
    canView ? serverFetch<EquipmentCostReport>(`/equipment/reports/costs?${range.toString()}`) : Promise.resolve(null),
    canView ? serverFetch<EquipmentUtilisationReport>(`/equipment/reports/utilisation?${range.toString()}`) : Promise.resolve(null),
    canView && active === 'reports'
      ? serverFetch<EquipmentFuelReport>(`/equipment/reports/fuel?${range.toString()}`)
      : Promise.resolve(null),
  ]);
  const machines = register.items;
  const onSite = machines.filter((machine) => machine.current_site).length;
  const hired = machines.filter((machine) => machine.ownership === 'hired').length;
  const servicesDue = due.services.filter((plan) => plan.state === 'due' || plan.state === 'overdue').length;
  const papersDue = due.documents.length;
  const notLogged = board.sites.reduce((sum, site) => sum + site.machines.filter((m) => !m.logged_today).length, 0);
  const utilRows = utilisation?.rows ?? [];
  const worked = utilRows.reduce((sum, row) => sum + Number(row.hours_worked), 0);
  const available = utilRows.reduce((sum, row) => sum + Number(row.hours_available), 0);
  const fleetUtil = available > 0 ? Math.round((Math.min(worked, available) / available) * 100) : null;
  const tabLabel: Record<TabKey, string> = {
    register: t('Register'),
    board: t('On site today'),
    maintenance: t('Servicing and papers'),
    reports: t('Cost and utilisation'),
  };
  const vendorOptions = vendors.map((vendor) => ({ id: vendor.id, name: vendor.name }));

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[21px] font-semibold leading-tight">{t('Equipment')}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Owned and hired machines, where they are, their hours, fuel, servicing and cost per site.')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canLog && (
            <Button asChild size="sm" variant="secondary">
              <Link href="/equipment/log">
                <ClipboardList className="size-4" />
                {t('Log a day')}
              </Link>
            </Button>
          )}
          {canView && (
            <Button asChild size="sm" variant="secondary">
              <Link href="/equipment/hire-statement">{t('Hire statements')}</Link>
            </Button>
          )}
          {canManage && <EquipmentDialog vendors={vendorOptions} />}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('Machines')}
          value={String(machines.length)}
          animate
          note={`${machines.length - hired} ${t('owned')} · ${hired} ${t('hired')}`}
        />
        <StatTile
          label={t('On site today')}
          value={String(onSite)}
          animate
          noteTone={notLogged > 0 ? 'pending' : 'done'}
          note={notLogged > 0 ? `${notLogged} ${t('not logged yet')}` : t('All logged')}
          href="/equipment?tab=board"
          hrefLabel={t('On site today')}
        />
        <StatTile
          label={t('Services due')}
          value={String(servicesDue)}
          animate
          noteTone={servicesDue > 0 ? 'blocked' : 'done'}
          note={`${papersDue} ${t('papers lapsing')}`}
          href="/equipment?tab=maintenance"
          hrefLabel={t('Servicing and papers')}
        />
        {canView && costs ? (
          <StatTile
            label={t('Cost, last 30 days')}
            value={moneyShort(costs.totals.total)}
            noteTone={utilisationTone(fleetUtil)}
            note={fleetUtil === null ? t('No hours yet') : `${fleetUtil}% ${t('utilisation')}`}
            href="/equipment?tab=reports"
            hrefLabel={t('Cost and utilisation')}
          />
        ) : (
          <StatTile label={t('Papers lapsing')} value={String(papersDue)} animate noteTone={papersDue > 0 ? 'pending' : 'done'} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map((key) => (
            <Link
              key={key}
              href={`/equipment?tab=${key}`}
              aria-current={key === active ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] leading-tight whitespace-nowrap transition',
                key === active ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-muted hover:text-ink',
              )}
            >
              {tabLabel[key]}
            </Link>
          ))}
        </nav>
        {canView && (active === 'register' || active === 'reports') && (
          <a
            href={`/equipment/export?kind=${active === 'register' ? 'register' : 'costs'}&${range.toString()}`}
            className="inline-flex items-center gap-1 pb-2 text-[12.5px] text-accent hover:underline"
          >
            <Download className="size-3.5" /> {t('Export CSV')}
          </a>
        )}
      </div>

      {active === 'register' &&
        (machines.length === 0 ? (
          <EmptyState
            icon={<Truck />}
            title={t('No machines yet')}
            body={t('Add the machines you own and the ones you hire. Hired kit needs its vendor in Procurement.')}
          />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink-muted">
                  <th className="px-3 py-2 text-start font-medium">{t('Machine')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('Owned / hired')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('Where')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('Meter')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('Servicing')}</th>
                  {canView && <th className="px-3 py-2 text-end font-medium">{t('Rate')}</th>}
                </tr>
              </thead>
              <tbody>
                {machines.map((machine) => (
                  <tr key={machine.id} className="border-b border-line-soft last:border-0 hover:bg-raised">
                    <td className="px-3 py-2">
                      <Link href={`/equipment/${machine.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{machine.name}</span>
                        <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
                          {machine.code}
                        </span>
                      </Link>
                      <span className="text-[12px] text-ink-muted">
                        {t(EQUIPMENT_CATEGORY_LABELS[machine.category as EquipmentCategory] ?? machine.category)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {machine.ownership === 'hired' ? (
                        <span>
                          {t('Hired')}
                          <span className="block text-[12px] text-ink-muted">{machine.vendor?.name}</span>
                        </span>
                      ) : (
                        t('Owned')
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={STATUS[machine.status]?.tone ?? 'neutral'}>{t(STATUS[machine.status]?.label ?? machine.status)}</Badge>
                        {machine.current_site && (
                          <Link href={`/projects/${machine.current_site.project.id}?tab=equipment`} className="text-[12px] hover:underline">
                            {machine.current_site.project.name}
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-end font-mono" dir="ltr">
                      {machine.meter_reading ? `${machine.meter_reading} ${machine.meter_type === 'km' ? 'km' : 'h'}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        {machine.service_state !== 'ok' && (
                          <Badge tone={SERVICE[machine.service_state].tone}>{t(SERVICE[machine.service_state].label)}</Badge>
                        )}
                        {(machine.documents_state === 'expiring' || machine.documents_state === 'expired') && (
                          <Badge tone={PAPERS[machine.documents_state].tone}>{t(PAPERS[machine.documents_state].label)}</Badge>
                        )}
                        {machine.service_state === 'ok' && machine.documents_state !== 'expiring' && machine.documents_state !== 'expired' && (
                          <span className="text-[12px] text-ink-muted">{t('Nothing due')}</span>
                        )}
                      </div>
                    </td>
                    {canView && (
                      <td className="px-3 py-2 text-end">
                        {machine.ownership === 'hired'
                          ? machine.hire_rate
                            ? `${money(machine.hire_rate)} ${t(HIRE_BASIS_LABEL[machine.hire_basis ?? 'hour'] ?? '')}`
                            : '—'
                          : machine.charge_out_rate && machine.charge_out_rate !== '0'
                            ? `${money(machine.charge_out_rate)} ${t(HIRE_BASIS_LABEL[machine.charge_out_basis ?? 'hour'] ?? '')}`
                            : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}

      {active === 'board' &&
        (board.sites.length === 0 ? (
          <EmptyState icon={<Truck />} title={t('Nothing on site')} body={t('Allocate a machine to a site from its page.')} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {board.sites.map((site) => (
              <Card key={site.project_id} className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/projects/${site.project_id}?tab=equipment`} className="text-[14px] font-semibold hover:underline">
                    {site.project_name}
                  </Link>
                  {canLog && (
                    <Link href={`/equipment/log?site=${site.project_id}`} className="text-[12.5px] text-accent hover:underline">
                      {t('Log a day')}
                    </Link>
                  )}
                </div>
                <ul className="flex flex-col divide-y divide-line-soft">
                  {site.machines.map((machine) => (
                    <li key={machine.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                      <Link href={`/equipment/${machine.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{machine.name}</span>
                        <span className="text-[12px] text-ink-muted">
                          <span className="font-mono" dir="ltr">
                            {machine.code}
                          </span>{' '}
                          · {t('since')} {shortDate(machine.since)}
                        </span>
                      </Link>
                      {machine.logged_today ? (
                        <Badge tone="done">
                          {machine.hours_today} {t('h today')}
                        </Badge>
                      ) : (
                        <Badge tone="pending">{t('Not logged today')}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        ))}

      {active === 'maintenance' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Services due')}</h3>
            {due.services.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('No service is due.')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {due.services.map((plan) => (
                  <li key={plan.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <Link href={`/equipment/${plan.equipment.id}`} className="flex flex-col hover:underline">
                      <span className="font-medium">
                        {plan.equipment.code} · {plan.equipment.name}
                      </span>
                      <span className="text-[12px] text-ink-muted">
                        {plan.name}
                        {plan.next_meter ? ` · ${t('at')} ${plan.next_meter} (${t('now')} ${plan.meter_reading ?? '—'})` : ''}
                        {plan.next_on ? ` · ${shortDate(plan.next_on)}` : ''}
                      </span>
                    </Link>
                    <Badge tone={SERVICE[plan.state].tone}>{t(SERVICE[plan.state].label)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold">{t('Papers lapsing')}</h3>
            {due.documents.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('Nothing lapses in the next 30 days.')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {due.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                    <Link href={`/equipment/${doc.equipment.id}`} className="flex flex-col hover:underline">
                      <span className="font-medium">
                        {doc.equipment.code} · {t(EQUIPMENT_DOCUMENT_LABELS[doc.kind as EquipmentDocumentKind] ?? doc.kind)}
                      </span>
                      <span className="text-[12px] text-ink-muted">
                        {t('Expires')} {shortDate(doc.expires_on)}
                      </span>
                    </Link>
                    <Badge tone={PAPERS[doc.standing].tone}>{t(PAPERS[doc.standing].label)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {active === 'reports' && costs && utilisation && (
        <div className="flex flex-col gap-4">
          <form className="flex flex-wrap items-end gap-2" action="/equipment">
            <input type="hidden" name="tab" value="reports" />
            <label className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
              {t('From')}
              <Input type="date" name="from" defaultValue={costs.from} max={todayIso()} className="w-40" />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
              {t('To')}
              <Input type="date" name="to" defaultValue={costs.to} className="w-40" />
            </label>
            <Button type="submit" size="sm" variant="secondary">
              {t('Show')}
            </Button>
            <span className="pb-2 text-[12.5px] text-ink-muted">
              {shortDate(costs.from)} – {shortDate(costs.to)}
            </span>
          </form>

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold">{t('Cost per machine and site')}</h3>
              <a href={`/equipment/export?kind=costs&${range.toString()}`} className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
                <Download className="size-3.5" /> CSV
              </a>
            </div>
            <p className="text-[12.5px] text-ink-muted">
              {t('“In cost report” is what equipment adds to each site’s actual cost. Fuel or repairs recorded as an expense, diesel from stock and a booked hire invoice are already counted there, so they are shown but not added again.')}
            </p>
            {costs.rows.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('No equipment cost in the period.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[12px] text-ink-muted">
                      <th className="py-1.5 text-start font-medium">{t('Machine')}</th>
                      <th className="py-1.5 text-start font-medium">{t('Site')}</th>
                      <th className="py-1.5 text-end font-medium">{t('Hours')}</th>
                      {COST_COLUMNS.map((kind) => (
                        <th key={kind} className="py-1.5 text-end font-medium">
                          {t(EQUIPMENT_COST_KIND_LABELS[kind])}
                        </th>
                      ))}
                      <th className="py-1.5 text-end font-medium">{t('In cost report')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.rows.map((row) => (
                      <tr key={`${row.equipment.id}:${row.project?.id ?? 'yard'}`} className="border-t border-line">
                        <td className="py-2">
                          <Link href={`/equipment/${row.equipment.id}`} className="hover:underline">
                            <span className="font-mono text-[12px]" dir="ltr">
                              {row.equipment.code}
                            </span>{' '}
                            {row.equipment.name}
                          </Link>
                        </td>
                        <td className="py-2">{row.project?.name ?? t('Yard')}</td>
                        <td className="py-2 text-end font-mono" dir="ltr">
                          {row.hours_worked}
                          {row.hours_charged !== row.hours_worked ? ` / ${row.hours_charged}` : ''}
                        </td>
                        {COST_COLUMNS.map((kind) => (
                          <td key={kind} className="py-2 text-end font-mono">
                            {row[kind] === '0' ? '—' : money(row[kind])}
                          </td>
                        ))}
                        <td className="py-2 text-end font-mono font-semibold">{money(row.counted)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line font-semibold">
                      <td className="py-2" colSpan={3}>
                        {t('Total')}
                      </td>
                      {COST_COLUMNS.map((kind) => (
                        <td key={kind} className="py-2 text-end font-mono">
                          {money(costs.totals[kind])}
                        </td>
                      ))}
                      <td className="py-2 text-end font-mono">{money(costs.totals.counted)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold">{t('Utilisation')}</h3>
                <a href={`/equipment/export?kind=utilisation&${range.toString()}`} className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
                  <Download className="size-3.5" /> CSV
                </a>
              </div>
              <p className="text-[12.5px] text-ink-muted">
                {t('Hours worked against a shift for every day on site, less breakdown. A day on site with no log counts as idle.')}
              </p>
              {utilRows.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{t('No machine was on site in the period.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-[12px] text-ink-muted">
                        <th className="py-1.5 text-start font-medium">{t('Machine')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Days')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Worked')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Idle')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Breakdown')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Utilisation')}</th>
                        <th className="py-1.5 text-end font-medium">{t('L/h')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {utilRows.map((row) => (
                        <tr key={row.equipment.id} className="border-t border-line">
                          <td className="py-2">
                            <span className="font-mono text-[12px]" dir="ltr">
                              {row.equipment.code}
                            </span>{' '}
                            {row.equipment.name}
                          </td>
                          <td className="py-2 text-end font-mono">{row.days_on_site}</td>
                          <td className="py-2 text-end font-mono">{row.hours_worked}</td>
                          <td className="py-2 text-end font-mono">{row.hours_idle}</td>
                          <td className="py-2 text-end font-mono">{row.hours_breakdown}</td>
                          <td className="py-2 text-end">
                            <Badge tone={utilisationTone(row.utilisation_percent)}>
                              {row.utilisation_percent === null ? '—' : `${row.utilisation_percent}%`}
                            </Badge>
                          </td>
                          <td className="py-2 text-end font-mono">{row.fuel_per_hour ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card className="flex flex-col gap-3 p-4">
              <h3 className="text-[14px] font-semibold">{t('Fuel check')}</h3>
              <p className="text-[12.5px] text-ink-muted">
                {t('Days a machine drew more than')} {fuel?.threshold_percent ?? 30}% {t('above its own usual litres per hour.')}
              </p>
              {!fuel || fuel.outliers.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{t('Nothing unusual in the period.')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line-soft">
                  {fuel.outliers.map((row) => (
                    <li key={`${row.equipment.id}:${row.date}`} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                      <span className="flex flex-col">
                        <span className="font-medium">
                          {row.equipment.code} · {shortDate(row.date)}
                        </span>
                        <span className="text-[12px] text-ink-muted">
                          {row.litres} L / {row.hours_worked} h · {row.project.name}
                        </span>
                      </span>
                      <Badge tone="blocked">
                        {row.fuel_per_hour} L/h · +{row.above_percent}%
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </FadeIn>
  );
}
