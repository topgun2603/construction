'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PLAN_MODULES, PLANS, planPricePaise, type Plan } from '@sitebook/shared';
import { startSubscription } from '@/lib/actions';
import type { Billing } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { money, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Choosing a plan.
 *
 * Says plainly that nothing is charged yet and the plan changes only once payment clears. That is not
 * legal boilerplate — it is what actually happens, and an owner who clicks Upgrade and then sees
 * "Starter" on the page would otherwise be right to think it had failed.
 *
 * A downgrade is not offered as a button. Dropping to Starter switches off modules a builder's staff
 * are using today, and the way to do it is to cancel — which keeps access to the end of the period
 * they have paid for rather than taking it away mid-month.
 */
export function PlanPicker({ currentPlan, billing }: { currentPlan: string; billing: Billing }) {
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [, start] = useTransition();

  function subscribe(plan: Plan) {
    setPendingPlan(plan);
    start(async () => {
      const result = await startSubscription(plan);
      setPendingPlan(null);

      if (!result.ok || !result.data) {
        toast.error(result.error ?? 'Could not start the subscription');
        return;
      }

      if (result.data.checkout_url) {
        // Razorpay's hosted checkout. A new tab rather than a redirect, so the builder still has the
        // plan page open when they come back and can see the status change.
        window.open(result.data.checkout_url, '_blank', 'noopener,noreferrer');
        toast.success('Checkout opened — your plan changes once the payment clears');
        return;
      }

      toast.success(
        result.data.dry_run
          ? 'Test mode: no checkout to open. The plan changes when the webhook confirms payment.'
          : 'Subscription started',
      );
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {PLANS.map((plan) => {
        const isCurrent = plan === currentPlan;
        const modules = PLAN_MODULES[plan];
        const extras = PLAN_MODULES.pro.filter((m) => !PLAN_MODULES.starter.includes(m));
        const busy = pendingPlan === plan;
        // Only an upgrade is actionable. Downgrading happens by cancelling, so the period already
        // paid for is honoured instead of taken away.
        const isUpgrade = plan === 'pro' && currentPlan === 'starter';

        return (
          <Card
            key={plan}
            className={cn(
              'flex flex-col gap-3 p-5',
              isCurrent && 'border-accent',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[17px] font-semibold capitalize">{titleCase(plan)}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[24px] font-semibold leading-none">
                    {money(planPricePaise(plan).toString())}
                  </span>
                  <span className="text-[13px] text-ink-muted">a month</span>
                </span>
              </div>
              {isCurrent && <Badge tone="accent">Current</Badge>}
            </div>

            <ul className="flex flex-col gap-1.5">
              <li className="flex items-start gap-2 text-[13.5px]">
                <Check className="mt-0.5 size-4 flex-none text-done" />
                <span>
                  {modules.length} modules — sites, daily reports, attendance, labour and wages
                </span>
              </li>
              {plan === 'pro' && (
                <li className="flex items-start gap-2 text-[13.5px]">
                  <Check className="mt-0.5 size-4 flex-none text-done" />
                  <span>
                    Plus {extras.map((m) => titleCase(m)).join(', ')}
                  </span>
                </li>
              )}
              <li className="flex items-start gap-2 text-[13.5px]">
                <Check className="mt-0.5 size-4 flex-none text-done" />
                <span>Unlimited sites, workers and people</span>
              </li>
            </ul>

            <div className="mt-auto pt-1">
              {isCurrent ? (
                <span className="text-[13px] text-ink-muted">
                  {billing.status === 'active'
                    ? 'Your current plan, paid up.'
                    : billing.status === 'trialing'
                      ? 'Waiting for the first payment to clear.'
                      : 'Your current plan.'}
                </span>
              ) : isUpgrade ? (
                <Button onClick={() => subscribe(plan)} disabled={busy} className="w-full">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  Upgrade to Pro
                </Button>
              ) : (
                <span className="text-[13px] leading-relaxed text-ink-muted">
                  To move down to Starter, cancel your subscription. You keep Pro until the period you
                  have paid for ends.
                </span>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
