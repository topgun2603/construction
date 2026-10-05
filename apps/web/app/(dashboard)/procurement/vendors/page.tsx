import Link from 'next/link';
import { Truck } from 'lucide-react';
import { displayPhone, taxRule } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Vendor } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { VendorFormDialog } from './vendor-form-dialog';

export const metadata = { title: 'Suppliers · BUILDR' };

/** The company's suppliers, active first. */
export default async function VendorsPage() {
  const t = await getT();
  const me = await requireSelf();
  const vendors = await serverFetch<Vendor[]>('/vendors');
  const canManage = me.permissions.includes('vendors.manage');
  const idLabel = taxRule(me.tenant.tax_regime).idLabel;

  return (
    <FadeIn className="flex flex-col gap-5">
      {canManage && (
        <div className="flex justify-end">
          <VendorFormDialog />
        </div>
      )}
      {vendors.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title={t('No suppliers yet')}
          body={t('Add the dealers and suppliers you buy from, with their tax number and payment terms.')}
          action={canManage ? <VendorFormDialog /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-2.5 text-start font-semibold">{t('Supplier')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('Contact')}</th>
                {idLabel && <th className="px-3 py-2.5 text-start font-semibold">{idLabel}</th>}
                <th className="px-3 py-2.5 text-end font-semibold">{t('Terms')}</th>
                <th className="px-4 py-2.5 text-end font-semibold">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor) => (
                <tr key={vendor.id} className="border-b border-line-soft last:border-0 hover:bg-raised">
                  <td className="px-4 py-2.5">
                    <Link href={`/procurement/vendors/${vendor.id}`} className="font-medium hover:underline">
                      {vendor.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {[vendor.contact_name, vendor.phone ? displayPhone(vendor.phone) : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  {idLabel && <td className="px-3 py-2.5 font-mono text-[12.5px]">{vendor.tax_id ?? '—'}</td>}
                  <td className="px-3 py-2.5 text-end text-ink-muted">
                    {vendor.payment_terms_days === null ? '—' : `${vendor.payment_terms_days} ${t('days')}`}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Badge tone={vendor.active ? 'done' : 'neutral'}>{vendor.active ? t('Active') : t('Inactive')}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FadeIn>
  );
}
