import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import {
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_COST_KIND_LABELS,
  EQUIPMENT_DOCUMENT_LABELS,
  type EquipmentCategory,
  type EquipmentDocumentKind,
} from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { Page, ProjectSummary } from '@/lib/api-types';
import type { Vendor } from '@/lib/procurement-types';
import type { EquipmentDetail } from '@/lib/equipment-types';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ExportMenu } from '@/components/export-menu';
import { EquipmentDialog } from '../equipment-dialog';
import { HIRE_BASIS_LABEL, PAPERS, SERVICE, STATUS, utilisationTone } from '../labels';
import {
  AllocateDialog,
  DocumentDialog,
  MaintenanceDialog,
  ReleaseDialog,
  RemoveDocumentButton,
  ServicePlanDialog,
} from './machine-actions';

export const metadata = { title: 'Machine · BUILDR' };

const COST_KINDS = ['hire', 'mobilisation', 'operator', 'charge_out', 'fuel', 'maintenance'] as const;

/** One machine: where it has been, its daily logs, servicing, papers and what it has cost. */
export default async function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();
  const can = (permission: string) => me.permissions.includes(permission);
  const canView = can('equipment.view');
  const canManage = can('equipment.manage');
  const canLog = can('equipment.log') || canManage;

  let machine: EquipmentDetail;
  try {
    machine = await serverFetch<EquipmentDetail>(`/equipment/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const [sites, vendors] = await Promise.all([
    canManage
      ? serverFetch<Page<ProjectSummary>>('/projects?limit=200').then((page) =>
          page.items.filter((site) => site.status !== 'completed').map((site) => ({ id: site.id, name: site.name })),
        )
      : Promise.resolve([]),
    canManage ? serverFetch<Vendor[]>('/vendors?active=true').catch(() => [] as Vendor[]) : Promise.resolve([] as Vendor[]),
  ]);
  const unit = machine.meter_type === 'km' ? 'km' : 'h';
  const cost = machine.cost;
  const use = machine.utilisation;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/equipment" className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t('Equipment')}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-[21px] font-semibold leading-tight">
              {machine.name}{' '}
              <span className="font-mono text-[15px] text-ink-muted" dir="ltr">
                {machine.code}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              <Badge tone={STATUS[machine.status]?.tone ?? 'neutral'}>{t(STATUS[machine.status]?.label ?? machine.status)}</Badge>
              <span>{t(EQUIPMENT_CATEGORY_LABELS[machine.category as EquipmentCategory] ?? machine.category)}</span>
              {[machine.make, machine.model].filter(Boolean).length > 0 && <span>· {[machine.make, machine.model].filter(Boolean).join(' ')}</span>}
              {machine.registration_no && (
                <span dir="ltr" className="font-mono">
                  · {machine.registration_no}
                </span>
              )}
              <span>
                · {machine.ownership === 'hired' ? `${t('Hired from')} ${machine.vendor?.name ?? ''}` : t('Owned')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canLog && machine.current_site && (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/equipment/log?machine=${machine.id}`}>
                  <ClipboardList className="size-4" />
                  {t('Log a day')}
                </Link>
              </Button>
            )}
            {canManage && (
              <>
                <AllocateDialog machineId={machine.id} sites={sites} currentSiteId={machine.current_site?.project.id} />
                {machine.current_site && (
                  <ReleaseDialog machineId={machine.id} ownership={machine.ownership} projectId={machine.current_site.project.id} />
                )}
                <EquipmentDialog vendors={vendors.map((vendor) => ({ id: vendor.id, name: vendor.name }))} initial={machine} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('Where')}
          value={machine.current_site?.project.name ?? t('Not on a site')}
          note={machine.current_site ? `${t('since')} ${shortDate(machine.current_site.since)}` : undefined}
          href={machine.current_site ? `/projects/${machine.current_site.project.id}?tab=equipment` : undefined}
          hrefLabel={t('Open the site')}
        />
        <StatTile
          label={t('Meter')}
          value={machine.meter_reading ? `${machine.meter_reading} ${unit}` : '—'}
          noteTone={SERVICE[machine.service_state].tone}
          note={t(SERVICE[machine.service_state].label)}
        />
        {use && (
          <StatTile
            label={t('Utilisation, last 30 days')}
            value={use.utilisation_percent === null ? '—' : `${use.utilisation_percent}%`}
            noteTone={utilisationTone(use.utilisation_percent)}
            note={`${use.hours_worked} ${t('h worked of')} ${use.hours_available} · ${use.fuel_per_hour ?? '—'} L/h`}
          />
        )}
        {cost && (
          <StatTile
            label={t('Cost, last 30 days')}
            value={money(cost.totals.total)}
            note={`${money(cost.totals.counted)} ${t('in the cost report')}`}
          />
        )}
      </div>

      {canView && (
        <Card className="flex flex-col gap-2 p-4 text-[13px]">
          <h3 className="text-[14px] font-semibold">{t('Terms')}</h3>
          {machine.ownership === 'hired' ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                {t('Rate')}: {machine.hire_rate ? money(machine.hire_rate) : '—'} {t(HIRE_BASIS_LABEL[machine.hire_basis ?? 'hour'] ?? '')}
              </span>
              {machine.min_hours && (
                <span>
                  {machine.hire_basis === 'month' ? t('Hours covered a month') : t('Minimum hours a day')}: {machine.min_hours}
                </span>
              )}
              <span>
                {t('Operator')}:{' '}
                {machine.operator_included ? t('included') : `${money(machine.operator_rate)} ${t('per working day')}`}
              </span>
              <span>
                {t('Fuel')}: {machine.fuel_included ? t('included') : t('ours')}
              </span>
              {machine.mobilisation_charge && machine.mobilisation_charge !== '0' && (
                <span>
                  {t('Mobilisation')}: {money(machine.mobilisation_charge)}
                </span>
              )}
            </div>
          ) : (
            <span>
              {t('Charged to the site')}:{' '}
              {machine.charge_out_rate && machine.charge_out_rate !== '0'
                ? `${money(machine.charge_out_rate)} ${t(HIRE_BASIS_LABEL[machine.charge_out_basis ?? 'hour'] ?? '')}`
                : t('nothing — no internal rate set')}
            </span>
          )}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold">{t('Daily logs')}</h3>
            <ExportMenu
              kind="equipment_logs"
              filters={{ equipment_id: machine.id }}
              csvHref={canView ? `/equipment/export?kind=logs&equipment_id=${machine.id}` : undefined}
            />
          </div>
          {machine.logs.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{t('Nothing logged yet.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[12px] text-ink-muted">
                    <th className="py-1.5 text-start font-medium">{t('Date')}</th>
                    <th className="py-1.5 text-start font-medium">{t('Site')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Meter')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Worked')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Idle')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Breakdown')}</th>
                    <th className="py-1.5 text-end font-medium">{t('Fuel')}</th>
                    <th className="py-1.5 text-start font-medium">{t('Operator')}</th>
                  </tr>
                </thead>
                <tbody>
                  {machine.logs.map((log) => (
                    <tr key={log.id} className="border-t border-line align-top">
                      <td className="py-2 whitespace-nowrap">{shortDate(log.log_date)}</td>
                      <td className="py-2">
                        {log.project.name}
                        {log.work_done && <span className="block text-[12px] text-ink-muted">{log.work_done}</span>}
                      </td>
                      <td className="py-2 text-end font-mono" dir="ltr">
                        {log.opening_meter && log.closing_meter ? `${log.opening_meter}–${log.closing_meter}` : '—'}
                      </td>
                      <td className="py-2 text-end font-mono">{log.hours_worked}</td>
                      <td className="py-2 text-end font-mono">{log.idle_hours}</td>
                      <td className="py-2 text-end font-mono">{log.breakdown_hours}</td>
                      <td className="py-2 text-end font-mono">
                        {log.fuel_litres ? `${log.fuel_litres} L` : '—'}
                        {log.fuel_per_hour !== null && <span className="block text-[11.5px] text-ink-muted">{log.fuel_per_hour} L/h</span>}
                      </td>
                      <td className="py-2">{log.operator?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold">{t('Where it has been')}</h3>
            </div>
            {machine.allocations.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('Never allocated to a site.')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
                {machine.allocations.map((allocation) => (
                  <li key={allocation.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="flex flex-col">
                      <Link href={`/projects/${allocation.project.id}?tab=equipment`} className="font-medium hover:underline">
                        {allocation.project.name}
                      </Link>
                      {allocation.cost_code && (
                        <span className="text-[12px] text-ink-muted">
                          {allocation.cost_code.code} · {allocation.cost_code.name}
                        </span>
                      )}
                    </span>
                    <span className="text-[12.5px] text-ink-muted">
                      {shortDate(allocation.from_date)} – {allocation.to_date ? shortDate(allocation.to_date) : t('now')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold">{t('Servicing')}</h3>
              {canManage && (
                <div className="flex flex-wrap gap-1">
                  <ServicePlanDialog machineId={machine.id} meterType={machine.meter_type} />
                  <MaintenanceDialog
                    machineId={machine.id}
                    plans={machine.service_plans.filter((plan) => plan.active)}
                    canRecordExpense={can('expenses.record')}
                    meterUnit={unit}
                  />
                </div>
              )}
            </div>
            {machine.service_plans.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('No service plan. Add one to be reminded when a service falls due.')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
                {machine.service_plans.map((plan) => (
                  <li key={plan.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="flex flex-col">
                      <span className="font-medium">{plan.name}</span>
                      <span className="text-[12px] text-ink-muted">
                        {plan.next_meter ? `${t('next at')} ${plan.next_meter} ${unit}` : ''}
                        {plan.next_meter && plan.next_on ? ' · ' : ''}
                        {plan.next_on ? `${t('by')} ${shortDate(plan.next_on)}` : ''}
                      </span>
                    </span>
                    <Badge tone={SERVICE[plan.state].tone}>{t(SERVICE[plan.state].label)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {machine.maintenance.length > 0 && (
              <ul className="flex flex-col divide-y divide-line-soft border-t border-line text-[13px]">
                {machine.maintenance.map((record) => (
                  <li key={record.id} className="flex items-start justify-between gap-2 py-2">
                    <span className="flex flex-col">
                      <span className="font-medium">{record.description}</span>
                      <span className="text-[12px] text-ink-muted">
                        {shortDate(record.done_on)} · {record.kind === 'breakdown' ? t('Breakdown') : t('Service')}
                        {record.downtime_hours ? ` · ${record.downtime_hours} ${t('h down')}` : ''}
                        {` · ${record.project?.name ?? t('Yard')}`}
                      </span>
                    </span>
                    <span className="text-end">
                      {record.cost && record.cost !== '0' ? money(record.cost) : '—'}
                      {record.expense_id && <span className="block text-[11.5px] text-ink-muted">{t('as an expense')}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold">{t('Documents')}</h3>
              {canManage && <DocumentDialog machineId={machine.id} />}
            </div>
            {machine.documents.length === 0 ? (
              <p className="text-[13px] text-ink-muted">{t('No documents. Insurance and fitness lapses are reminded 30 days ahead.')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
                {machine.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="flex flex-col">
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {t(EQUIPMENT_DOCUMENT_LABELS[doc.kind as EquipmentDocumentKind] ?? doc.kind)}
                        </a>
                      ) : (
                        <span className="font-medium">{t(EQUIPMENT_DOCUMENT_LABELS[doc.kind as EquipmentDocumentKind] ?? doc.kind)}</span>
                      )}
                      <span className="text-[12px] text-ink-muted">
                        {doc.number ? <span dir="ltr">{doc.number}</span> : null}
                        {doc.expires_on ? ` · ${t('expires')} ${shortDate(doc.expires_on)}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Badge tone={PAPERS[doc.standing].tone}>{t(PAPERS[doc.standing].label)}</Badge>
                      {canManage && <RemoveDocumentButton machineId={machine.id} documentId={doc.id} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {cost && cost.rows.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-[14px] font-semibold">
            {t('Cost by site')} · {shortDate(cost.from)} – {shortDate(cost.to)}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[12px] text-ink-muted">
                  <th className="py-1.5 text-start font-medium">{t('Site')}</th>
                  {COST_KINDS.map((kind) => (
                    <th key={kind} className="py-1.5 text-end font-medium">
                      {t(EQUIPMENT_COST_KIND_LABELS[kind])}
                    </th>
                  ))}
                  <th className="py-1.5 text-end font-medium">{t('In cost report')}</th>
                </tr>
              </thead>
              <tbody>
                {cost.rows.map((row) => (
                  <tr key={row.project?.id ?? 'yard'} className="border-t border-line">
                    <td className="py-2">{row.project?.name ?? t('Yard')}</td>
                    {COST_KINDS.map((kind) => (
                      <td key={kind} className="py-2 text-end font-mono">
                        {row[kind] === '0' ? '—' : money(row[kind])}
                      </td>
                    ))}
                    <td className="py-2 text-end font-mono font-semibold">{money(row.counted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </FadeIn>
  );
}
