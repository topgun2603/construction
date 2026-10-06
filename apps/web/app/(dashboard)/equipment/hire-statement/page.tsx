import Link from 'next/link';
import { ArrowLeft, ReceiptText } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import type { EquipmentHireStatement, EquipmentSummary } from '@/lib/equipment-types';
import { FadeIn } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { HIRE_BASIS_LABEL } from '../labels';
import { BookHireButton } from './book-hire-button';

export const metadata = { title: 'Hire statement · BUILDR' };

/**
 * One vendor's month, worked out from the daily logs and the hire terms — days, hours, the minimum
 * topped up, hire, operator and mobilisation per machine and site. What the vendor's invoice is
 * checked against before it is booked.
 */
export default async function HireStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; month?: string }>;
}) {
  const t = await getT();
  const { money, shortDate, todayIso } = await getFormat();
  const me = await requireSelf();
  const params = await searchParams;
  const canView = me.permissions.includes('equipment.view');
  const canManage = me.permissions.includes('equipment.manage');
  if (!canView) {
    return (
      <FadeIn className="flex flex-col gap-5">
        <h2 className="text-[21px] font-semibold leading-tight">{t('Hire statements')}</h2>
        <EmptyState icon={<ReceiptText />} title={t('Not available')} body={t('Hire statements need permission to see equipment cost.')} />
      </FadeIn>
    );
  }

  // The vendors worth choosing are the ones machines are hired from.
  const hired = await serverFetch<{ items: EquipmentSummary[] }>('/equipment?ownership=hired');
  const archived = await serverFetch<{ items: EquipmentSummary[] }>('/equipment?ownership=hired&archived=true');
  const vendors = [
    ...new Map(
      [...hired.items, ...archived.items]
        .filter((machine) => machine.vendor)
        .map((machine) => [machine.vendor!.id, machine.vendor!] as const),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const vendorId = params.vendor ?? vendors[0]?.id ?? '';
  const month = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month! : todayIso().slice(0, 7);
  const statement = vendorId
    ? await serverFetch<EquipmentHireStatement>(`/equipment/hire-statement?vendor_id=${vendorId}&month=${month}`).catch(() => null)
    : null;
  const unbooked = statement?.rows.filter((row) => !row.booked && row.total !== '0').length ?? 0;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/equipment?tab=reports" className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t('Equipment')}
        </Link>
        <h2 className="text-[21px] font-semibold leading-tight">{t('Hire statements')}</h2>
        <p className="text-[13.5px] text-ink-muted">
          {t('What each vendor should be charging for the month, from the daily logs and the agreed terms. Check their invoice against it, then book it.')}
        </p>
      </div>

      {vendors.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title={t('No hired machines')} body={t('Register a hired machine with its vendor and terms first.')} />
      ) : (
        <>
          <form className="flex flex-wrap items-end gap-2" action="/equipment/hire-statement">
            <label className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
              {t('Vendor')}
              <select
                name="vendor"
                defaultValue={vendorId}
                className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-[14px] text-ink"
              >
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
              {t('Month')}
              <Input type="month" name="month" defaultValue={month} max={todayIso().slice(0, 7)} className="w-44" />
            </label>
            <Button type="submit" size="sm" variant="secondary">
              {t('Show')}
            </Button>
          </form>

          {!statement ? (
            <p className="text-[13px] text-ink-muted">{t('No statement for that month.')}</p>
          ) : (
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold">
                  {statement.vendor.name} · {shortDate(statement.from)} – {shortDate(statement.to)}
                </h3>
                {canManage && unbooked > 0 && (
                  <BookHireButton vendorId={statement.vendor.id} month={statement.month} total={money(statement.total)} />
                )}
              </div>
              {statement.rows.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{t('Nothing hired from this vendor was on a site that month.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-[12px] text-ink-muted">
                        <th className="py-1.5 text-start font-medium">{t('Machine')}</th>
                        <th className="py-1.5 text-start font-medium">{t('Site')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Rate')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Days')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Hours worked')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Hours charged')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Hire')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Operator')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Mobilisation')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Total')}</th>
                        <th className="py-1.5 text-end font-medium">{t('Booked')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.rows.map((row) => (
                        <tr key={`${row.equipment.id}:${row.project?.id ?? ''}`} className="border-t border-line">
                          <td className="py-2">
                            <Link href={`/equipment/${row.equipment.id}`} className="hover:underline">
                              <span className="font-mono text-[12px]" dir="ltr">
                                {row.equipment.code}
                              </span>{' '}
                              {row.equipment.name}
                            </Link>
                          </td>
                          <td className="py-2">{row.project?.name ?? '—'}</td>
                          <td className="py-2 text-end">
                            {money(row.rate)} {t(HIRE_BASIS_LABEL[row.hire_basis ?? 'hour'] ?? '')}
                            {row.min_hours && (
                              <span className="block text-[11.5px] text-ink-muted">
                                {row.hire_basis === 'month' ? t('covers') : t('min')} {row.min_hours} h
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-end font-mono">{row.days}</td>
                          <td className="py-2 text-end font-mono">{row.hours_worked}</td>
                          <td className="py-2 text-end font-mono">
                            {row.hours_charged}
                            {row.minimum_top_up !== '0' && (
                              <span className="block text-[11.5px] text-ink-muted">
                                +{row.minimum_top_up} {t('minimum')}
                              </span>
                            )}
                            {row.extra_hours !== '0' && (
                              <span className="block text-[11.5px] text-ink-muted">
                                {row.extra_hours} {t('extra')}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-end font-mono">{money(row.hire)}</td>
                          <td className="py-2 text-end font-mono">{row.operator === '0' ? '—' : money(row.operator)}</td>
                          <td className="py-2 text-end font-mono">{row.mobilisation === '0' ? '—' : money(row.mobilisation)}</td>
                          <td className="py-2 text-end font-mono font-semibold">{money(row.total)}</td>
                          <td className="py-2 text-end">
                            {row.booked ? (
                              <Badge tone="done">{row.booked.invoice_ref ?? t('Booked')}</Badge>
                            ) : (
                              <Badge tone="pending">{t('Not yet')}</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-line font-semibold">
                        <td className="py-2" colSpan={9}>
                          {t('Total')}
                        </td>
                        <td className="py-2 text-end font-mono">{money(statement.total)}</td>
                        <td className="py-2 text-end font-mono">{money(statement.booked_total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </FadeIn>
  );
}
