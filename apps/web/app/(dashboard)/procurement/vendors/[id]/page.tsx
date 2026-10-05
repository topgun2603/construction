import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { displayPhone, taxRule } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { VendorDetail } from '@/lib/procurement-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { ORDER_STATUS } from '../../status';
import { VendorControls } from './vendor-controls';

export const metadata = { title: 'Supplier · BUILDR' };

/** One supplier: their details and what has been ordered from them. */
export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { money, shortDate } = await getFormat();
  const { id } = await params;
  const me = await requireSelf();

  let vendor: VendorDetail;
  try {
    vendor = await serverFetch<VendorDetail>(`/vendors/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const idLabel = taxRule(me.tenant.tax_regime).idLabel;

  const details: Array<[string, string | null]> = [
    [t('Contact person'), vendor.contact_name],
    [t('Phone'), vendor.phone ? displayPhone(vendor.phone) : null],
    [t('Email'), vendor.email],
    [idLabel ?? t('Tax number'), vendor.tax_id],
    [t('Payment terms'), vendor.payment_terms_days === null ? null : `${vendor.payment_terms_days} ${t('days')}`],
    [t('Address'), vendor.address],
    [t('Notes'), vendor.notes],
  ];

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/procurement/vendors"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3 rtl:rotate-180" /> {t('Suppliers')}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[21px] font-semibold leading-tight">{vendor.name}</h2>
            <Badge tone={vendor.active ? 'done' : 'neutral'}>{vendor.active ? t('Active') : t('Inactive')}</Badge>
          </div>
          <span className="text-[13px] text-ink-muted">
            {t('Ordered so far')}: <span className="font-mono">{money(vendor.ordered_total)}</span>
          </span>
        </div>
        {me.permissions.includes('vendors.manage') && (
          <VendorControls vendor={vendor} hasHistory={vendor.orders.length > 0} />
        )}
      </div>

      <Card className="p-4">
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr]">
          {details
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="whitespace-pre-line">{value}</dd>
              </div>
            ))}
        </dl>
      </Card>

      <Card className="flex flex-col">
        <span className="border-b border-line-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {t('Purchase orders')}
        </span>
        {vendor.orders.length === 0 ? (
          <span className="px-4 py-4 text-[13px] text-ink-muted">{t('Nothing ordered yet.')}</span>
        ) : (
          <ul className="flex flex-col">
            {vendor.orders.map((order) => (
              <li
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5 text-[13px] last:border-0"
              >
                <Link href={`/procurement/orders/${order.id}`} className="font-mono font-semibold hover:underline">
                  {order.number}
                </Link>
                <span className="text-ink-muted">{order.project_name}</span>
                <span className="text-ink-muted">{shortDate(order.created_at.slice(0, 10))}</span>
                <Badge tone={ORDER_STATUS[order.status].tone}>{t(ORDER_STATUS[order.status].label)}</Badge>
                <span className="font-mono">{money(order.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </FadeIn>
  );
}
