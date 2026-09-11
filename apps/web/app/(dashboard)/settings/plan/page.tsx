import { AlertTriangle, Check, Minus } from 'lucide-react';
import { MODULES, PLAN_MODULES, planPricePaise, type ModuleName } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Billing, BillingInvoice, Tenant } from '@/lib/api-types';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { longDate, money, titleCase } from '@/lib/format';
import { PlanPicker } from './plan-picker';
import { SubscriptionActions } from './subscription-actions';

export const metadata = { title: 'Plan · BUILDR' };

const PHASE_LABEL: Partial<Record<ModuleName, string>> = {
  client_portal: 'Coming soon',
  documents: 'Coming soon',
};

const STATUS_TONE: Record<Billing['status'], Tone> = {
  none: 'neutral',
  trialing: 'pending',
  active: 'done',
  past_due: 'blocked',
  cancelled: 'neutral',
};

const STATUS_LABEL: Record<Billing['status'], string> = {
  none: 'Not subscribed',
  trialing: 'Awaiting first payment',
  active: 'Paid',
  past_due: 'Payment failed',
  cancelled: 'Cancelled',
};

/**
 * Plan and billing.
 *
 * Ordered by urgency, not by tidiness. A failed payment is the only thing on this page that needs
 * doing today, so it goes above everything — including the plan the owner came to look at.
 */
export default async function PlanPage() {
  const [tenant, billing, invoices, me] = await Promise.all([
    serverFetch<Tenant>('/tenants/current'),
    serverFetch<Billing>('/billing'),
    serverFetch<BillingInvoice[]>('/billing/invoices'),
    requireSelf(),
  ]);

  const enabled = new Set(tenant.enabled_modules);
  const proOnly = new Set(PLAN_MODULES.pro.filter((m) => !PLAN_MODULES.starter.includes(m)));
  const canManage = me.permissions.includes('tenant.manage');

  return (
    <FadeIn className="flex flex-col gap-4">
      {/*
        Above the fold and unmissable. The builder keeps working through the grace period, so this is
        the only warning they get before the plan drops — and it says when that happens rather than
        leaving them to guess.
      */}
      {billing.status === 'past_due' && (
        <Card className="flex flex-wrap items-start gap-3 border-blocked/40 bg-blocked-bg p-4">
          <AlertTriangle className="mt-0.5 size-5 flex-none text-blocked-fg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[14.5px] font-semibold text-blocked-fg">
              Your last payment did not go through
            </span>
            <span className="text-[13px] leading-relaxed text-ink-soft">
              Nothing has stopped working — you have paid for the current period
              {billing.current_period_end
                ? `, which runs to ${longDate(billing.current_period_end.slice(0, 10))}`
                : ''}
              . Update your payment method before then, or the account moves to Starter and the Pro
              modules switch off.
            </span>
          </div>
          {canManage && <SubscriptionActions billing={billing} retry />}
        </Card>
      )}

      {billing.cancel_at && billing.status !== 'cancelled' && (
        <Card className="flex items-start gap-3 p-4">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-semibold">
              Cancelling on {longDate(billing.cancel_at.slice(0, 10))}
            </span>
            <span className="text-[13px] leading-relaxed text-ink-muted">
              You keep everything until then — it is already paid for. Subscribe again before that
              date and nothing changes.
            </span>
          </div>
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Current plan
          </span>
          <span className="text-[21px] font-semibold capitalize">{tenant.plan}</span>
          <span className="text-[13.5px] text-ink-muted">
            {money(planPricePaise(tenant.plan as never).toString())} a month ·{' '}
            {enabled.size} of {MODULES.length} modules on
            {billing.status === 'active' && billing.current_period_end
              ? ` · renews ${longDate(billing.current_period_end.slice(0, 10))}`
              : ''}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[billing.status]}>{STATUS_LABEL[billing.status]}</Badge>
          {tenant.status !== 'active' && (
            <Badge tone="blocked">{titleCase(tenant.status)}</Badge>
          )}
          {canManage && billing.status !== 'past_due' && (
            <SubscriptionActions billing={billing} />
          )}
        </div>
      </Card>

      {!billing.billing_configured && (
        <p className="rounded-btn bg-pending-bg px-3 py-2.5 text-[13px] leading-relaxed text-pending-fg">
          Razorpay is not configured on this deployment, so checkout runs in test mode and no money
          moves. Plan changes still work end to end — they are applied by the webhook exactly as they
          would be in production.
        </p>
      )}

      {canManage && <PlanPicker currentPlan={tenant.plan} billing={billing} />}

      <Card className="flex flex-col">
        <div className="border-b border-line-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Modules
        </div>
        <ul className="divide-y divide-line-soft">
          {MODULES.map((moduleName) => {
            const on = enabled.has(moduleName);
            return (
              <li key={moduleName} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className={
                      on
                        ? 'flex size-5 items-center justify-center rounded-full bg-done-bg text-done-fg'
                        : 'flex size-5 items-center justify-center rounded-full bg-neutral-bg text-ink-faint'
                    }
                  >
                    {on ? <Check className="size-3" /> : <Minus className="size-3" />}
                  </span>
                  <span className={on ? 'text-[14px]' : 'text-[14px] text-ink-muted'}>
                    {titleCase(moduleName)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {PHASE_LABEL[moduleName] && (
                    <span className="text-[12px] text-ink-faint">{PHASE_LABEL[moduleName]}</span>
                  )}
                  {proOnly.has(moduleName) && !on && (
                    <Badge tone="accent" dot={false}>
                      Pro
                    </Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/*
        Shown whenever there is any history, including for a cancelled account — somebody needs their
        receipts for the accountant long after they have stopped paying.
      */}
      {invoices.length > 0 && (
        <Card className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Billing history
            </span>
            <span className="font-mono text-[13px] text-ink-muted">{invoices.length}</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-[14px] font-semibold">
                    {money(invoice.amount)}
                  </span>
                  <span className="text-[12.5px] text-ink-muted">
                    {invoice.paid_at
                      ? `Paid ${longDate(invoice.paid_at.slice(0, 10))}`
                      : invoice.issued_at
                        ? `Issued ${longDate(invoice.issued_at.slice(0, 10))}`
                        : 'Not yet issued'}
                  </span>
                </div>
                <div className="flex flex-none items-center gap-2.5">
                  <Badge tone={invoice.status === 'paid' ? 'done' : 'pending'} dot={false}>
                    {titleCase(invoice.status)}
                  </Badge>
                  {invoice.invoice_url && (
                    <a
                      href={invoice.invoice_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[13px] text-accent hover:underline"
                    >
                      Receipt
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!canManage && (
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Only an owner can change the plan or see billing history.
        </p>
      )}
    </FadeIn>
  );
}
