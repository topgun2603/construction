import { AlertTriangle, Check, Clock, Infinity as InfinityIcon } from 'lucide-react';
import { MODULES, PLANS, PLAN_LABELS, planPricePaise, type Plan } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Tenant } from '@/lib/api-types';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { longDate, money, titleCase } from '@/lib/format';

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
 * dates rather than about which of their sites they are allowed to see — the tiered model this
 * replaced hid the product's best half from the customers most likely to need it.
 *
 * Ordered by urgency. A term that has run out is the only thing here that needs doing today, so it
 * sits above the plan somebody came to look at.
 */
export default async function PlanPage() {
  const [tenant, me] = await Promise.all([
    serverFetch<Tenant>('/tenants/current'),
    requireSelf(),
  ]);

  const standing = me.tenant.plan_standing ?? 'active';
  const expiresOn = me.tenant.plan_expires_on;
  const current = tenant.plan as Plan;
  const lifetime = current === 'lifetime';

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
                ? // Said plainly, because the alternative is a supervisor on a site deciding the app is broken.
                  'Everything can still be read — your sites, wages and drawings are all here. Nothing new can be saved until the plan is renewed.'
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
              {PLAN_LABELS[current] ?? titleCase(current)}
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

      <div className="flex flex-col gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          What you can buy
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => (
            <Card
              key={plan}
              className={`flex flex-col gap-3 p-4 ${
                plan === current ? 'border-accent' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold">{PLAN_LABELS[plan]}</span>
                {plan === current && <Badge tone="done">Yours</Badge>}
              </div>
              <span className="font-mono text-[20px] font-bold leading-none">
                {money(planPricePaise(plan).toString())}
              </span>
              <span className="text-[12.5px] text-ink-muted">
                {plan === 'lifetime' ? 'Paid once, never again' : 'Paid up front for the term'}
              </span>
              {/*
                No feature list under each price, because there is no difference to list. Saying so
                once is more honest than four identical columns of ticks pretending to be a choice.
              */}
              <span className="mt-auto flex items-center gap-1.5 text-[12.5px] text-done-fg">
                <Check className="size-3.5" />
                Every feature
              </span>
            </Card>
          ))}
        </div>
      </div>

      <Card className="flex items-start gap-3 p-4">
        <Clock className="mt-0.5 size-5 flex-none text-ink-faint" />
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">
            {canManage(me) ? 'Changing or renewing your plan' : 'Who can change this'}
          </span>
          <span className="text-[13.5px] text-ink-soft">
            {canManage(me)
              ? // Honest about where this stands: money is collected outside the product for now,
                // and an operator sets the term. Pretending there is a buy button would be worse.
                'Talk to us and we will set it. Payment is arranged directly at the moment — there is nothing to pay for on this screen yet.'
              : 'Only the account owner can change the plan.'}
          </span>
        </div>
      </Card>
    </FadeIn>
  );
}

function canManage(me: Awaited<ReturnType<typeof requireSelf>>): boolean {
  return me.permissions.includes('tenant.manage');
}
