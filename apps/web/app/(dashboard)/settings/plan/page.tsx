import { AlertTriangle, Check, Clock, Infinity as InfinityIcon } from 'lucide-react';
import { MODULES, type PlanView } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Tenant } from '@/lib/api-types';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { longDate, money } from '@/lib/format';

export const metadata = { title: 'Plan · BUILDR' };

const STANDING_TONE: Record<string, Tone> = {
  active: 'done',
  grace: 'pending',
  expired: 'blocked',
};

/**
 * What this account has paid for, and for how much longer.
 *
 * Every plan is every feature. What a builder buys is a length of time, so this page is about
 * dates rather than about which of their sites they are allowed to see.
 *
 * The terms come from the API, not from this codebase — an operator can change a price or add a
 * term, and it shows here without a deploy.
 *
 * Ordered by urgency. A term that has run out is the only thing here that needs doing today, so it
 * sits above the plan somebody came to look at.
 */
export default async function PlanPage() {
  const [tenant, me, catalogue] = await Promise.all([
    serverFetch<Tenant>('/tenants/current'),
    requireSelf(),
    serverFetch<{ items: PlanView[] }>('/plans'),
  ]);

  const standing = me.tenant.plan_standing ?? 'active';
  const expiresOn = me.tenant.plan_expires_on;

  // Their own plan may have been retired since they bought it, in which case it is not in the
  // catalogue — so the code is the fallback rather than an empty heading.
  const current = catalogue.items.find((plan) => plan.code === tenant.plan);
  const lifetime = current ? current.months === null : !expiresOn;
  const canManage = me.permissions.includes('tenant.manage');

  return (
    <FadeIn className="flex flex-col gap-4">
      {standing !== 'active' && (
        <Card
          className={`flex items-start gap-3 p-4 ${
            standing === 'expired' ? 'border-blocked/40 bg-blocked-bg' : 'border-pending/40'
          }`}
        >
          <AlertTriangle
            className={`mt-0.5 size-5 flex-none ${
              standing === 'expired' ? 'text-blocked-fg' : 'text-pending-fg'
            }`}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">
              {standing === 'expired'
                ? 'This plan has run out'
                : 'This plan has ended — you are in the grace period'}
            </span>
            <span className="text-[13.5px] text-ink-soft">
              {standing === 'expired'
                ? 'Everything can still be read — your sites, wages and drawings are all here. Nothing new can be saved until the plan is renewed.'
                : 'Everything still works. Renew before the grace period ends and nothing changes.'}
            </span>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Your plan
            </span>
            <span className="flex items-center gap-2 text-[24px] font-semibold leading-tight">
              {lifetime && <InfinityIcon className="size-6 text-accent" />}
              {current?.name ?? tenant.plan}
            </span>
          </div>
          <Badge tone={STANDING_TONE[standing] ?? 'neutral'}>
            {standing === 'active' ? 'Active' : standing === 'grace' ? 'In grace' : 'Run out'}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-line-soft pt-4">
          <div className="flex flex-col">
            <span className="text-[12.5px] text-ink-muted">Runs until</span>
            <span className="text-[15px] font-medium">
              {lifetime || !expiresOn ? 'It does not end' : longDate(expiresOn.slice(0, 10))}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[12.5px] text-ink-muted">Everything included</span>
            <span className="text-[15px] font-medium">{MODULES.length} modules</span>
          </div>
        </div>
      </Card>

      {catalogue.items.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            What you can buy
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {catalogue.items.map((plan) => (
              <Card
                key={plan.id}
                className={`flex flex-col gap-3 p-4 ${
                  plan.code === tenant.plan
                    ? 'border-accent'
                    : plan.badge
                      ? 'border-accent/50 ring-1 ring-accent/20'
                      : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold">{plan.name}</span>
                  {plan.code === tenant.plan ? (
                    <Badge tone="done">Yours</Badge>
                  ) : (
                    plan.badge && <Badge tone="accent">{plan.badge}</Badge>
                  )}
                </div>
                <span className="font-mono text-[20px] font-bold leading-none">
                  {money(plan.price)}
                </span>
                <span className="text-[12.5px] text-ink-muted">
                  {plan.description ??
                    (plan.months === null
                      ? 'Paid once, never again'
                      : 'Paid up front for the term')}
                </span>
                {plan.highlights.length > 0 && (
                  <ul className="mt-auto flex flex-col gap-1 pt-1">
                    {plan.highlights.map((line) => (
                      <li
                        key={line}
                        className="flex items-start gap-1.5 text-[12.5px] text-ink-soft"
                      >
                        <Check className="mt-0.5 size-3.5 flex-none text-done-fg" />
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card className="flex items-start gap-3 p-4">
        <Clock className="mt-0.5 size-5 flex-none text-ink-faint" />
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">
            {canManage ? 'Changing or renewing your plan' : 'Who can change this'}
          </span>
          <span className="text-[13.5px] text-ink-soft">
            {canManage
              ? 'Talk to us and we will set it. Payment is arranged directly at the moment — there is nothing to pay for on this screen yet.'
              : 'Only the account owner can change the plan.'}
          </span>
        </div>
      </Card>
    </FadeIn>
  );
}
