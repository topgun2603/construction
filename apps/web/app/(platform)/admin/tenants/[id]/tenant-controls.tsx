'use client';

import { useState, useTransition } from 'react';
import {
  ArrowRight,
  Infinity as InfinityIcon,
  Loader2,
  Play,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { updateTenantPlan } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { PlanView } from '@sitebook/shared';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MODULES, moduleLabel } from './modules';
import { useLanguage } from '@/components/language-provider';

/**
 * The levers: plan, modules, and whether the account works at all.
 *
 * Suspension is the only action here behind a confirmation, and it names the tenant in the
 * dialog. The other two change what a builder can see; this one stops their site staff
 * filing today's attendance, and the operator should have to read the name of the company
 * that happens to before it does.
 *
 * Modules are individual toggles rather than a plan-only switch because real support work
 * needs the exception: a Starter customer trialling expenses for a fortnight, or a Pro
 * customer with one module turned off because it is misbehaving.
 */
export function TenantControls({
  tenantId,
  tenantName,
  plan,
  plans,
  status,
  enabledModules,
}: {
  tenantId: string;
  tenantName: string;
  plan: string;
  /** The catalogue, so the levers show whatever an operator has put on sale. */
  plans: PlanView[];
  status: string;
  enabledModules: string[];
}) {
  const { t } = useLanguage();
  const [pending, start] = useTransition();
  const [modules, setModules] = useState<string[]>(enabledModules);

  // By term rather than by code, so an operator who adds a second never-ending plan gets the same
  // treatment without anybody editing this file.
  const lifetime = plans.find((option) => option.months === null) ?? null;
  const terms = plans.filter((option) => option !== lifetime);

  const dirty =
    modules.length !== enabledModules.length ||
    modules.some((name) => !enabledModules.includes(name));

  function apply(
    patch: { plan?: string; status?: string; enabled_modules?: string[] },
    message: string,
  ) {
    start(async () => {
      const result = await updateTenantPlan({ tenantId, ...patch });
      if (result.ok) toast.success(message);
      else toast.error(result.error ?? 'That did not work');
    });
  }

  function toggle(name: string) {
    setModules((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      {/*
        Lifetime is lifted out of the term switcher and given its own row.

        It used to be the fourth button in a segmented control, which made a ₹24,999 grant that
        never expires exactly as easy to click as moving somebody to six months — one pixel of
        travel between "renews in July" and "never pay again", with no confirmation on either. It
        is the plan this product is sold on, so it should be the obvious action; it is also the one
        that cannot be undone by a renewal lapsing, so it should be a deliberate one.
      */}
      {lifetime && plan !== lifetime.code && (
        <ConfirmDialog
          title={`Give ${tenantName} ${lifetime.name}?`}
          body={
            <>
              {t('Their account stops having an end date. Nothing will expire, no renewal will come up, and the only way back is to put them on a term again — which starts that term from that day.')}
            </>
          }
          confirmLabel={`Give ${lifetime.name}`}
          successMessage={`${tenantName} is on ${lifetime.name}`}
          onConfirm={() => updateTenantPlan({ tenantId, plan: lifetime.code })}
          trigger={
            <button
              type="button"
              disabled={pending}
              className="group flex w-full items-center gap-3.5 rounded-panel bg-nav px-4 py-3.5 text-left transition hover:bg-nav-active disabled:opacity-60"
            >
              <span className="flex size-10 flex-none items-center justify-center rounded-[11px] bg-accent/25 text-accent-onDark ring-1 ring-inset ring-white/[0.1]">
                <InfinityIcon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14.5px] font-semibold text-white">
                  {t('Give')} {lifetime.name} · {money(lifetime.price)}
                </span>
                <span className="text-[12.5px] text-white/55">
                  {t('Paid once. The account never expires and no renewal comes up.')}
                </span>
              </span>
              <ArrowRight className="ml-auto size-4 flex-none text-white/40 transition group-hover:translate-x-0.5 group-hover:text-accent-onDark" />
            </button>
          }
        />
      )}

      {lifetime && plan === lifetime.code && (
        <div className="flex items-center gap-3.5 rounded-panel border border-accent bg-accent-soft px-4 py-3">
          <InfinityIcon className="size-5 flex-none text-accent" />
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold">{t('On')} {lifetime.name}</span>
            <span className="text-[12.5px] text-ink-soft">
              {t('This account has no end date. Putting them on a term below would give them one.')}
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {lifetime ? t('Or a renewing term') : t('Plan')}
          </span>
          {/*
            Said out loud because it is not obvious and it is not reversible by clicking back: an
            operator picking a term is recording that somebody has paid for that long, starting
            today. The old end date does not carry over.
          */}
          <span className="text-[12px] text-ink-faint">
            {t('Starts the term again from today')}
          </span>
          <div className="flex flex-wrap gap-1 rounded-btn bg-neutral-bg p-1">
            {terms.map((option) => (
              <button
                key={option.code}
                type="button"
                disabled={pending || plan === option.code}
                onClick={() => apply({ plan: option.code }, `${tenantName} moved to ${option.name}`)}
                className={cn(
                  'min-h-0 rounded-[7px] px-3 py-2 text-[13px] font-medium transition',
                  plan === option.code
                    ? 'bg-surface font-semibold text-ink shadow-seg'
                    : 'text-ink-soft hover:text-ink',
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
          {/* Said plainly, because it is the part that surprises people. */}
          <span className="text-[12px] text-ink-muted">
            {t('Changing the plan resets modules to that plan’s defaults.')}
          </span>
        </div>

        <div className="flex flex-col items-start gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Account')}
          </span>
          {status === 'active' ? (
            <ConfirmDialog
              title={t('Suspend this account?')}
              body={
                <>
                  {t('Everyone at')} <strong className="font-semibold text-ink">{tenantName}</strong> is
                  signed out within seconds and cannot file attendance, reports or expenses until
                  you switch it back. Their data is untouched.
                </>
              }
              confirmLabel={t('Suspend account')}
              successMessage={`${tenantName} suspended`}
              onConfirm={() => updateTenantPlan({ tenantId, status: 'suspended' })}
              trigger={
                <Button variant="destructive" size="sm" disabled={pending}>
                  <ShieldAlert className="size-4" />
                  {t('Suspend')}
                </Button>
              }
            />
          ) : (
            <>
              <Button
                variant="approve"
                size="sm"
                disabled={pending}
                onClick={() => apply({ status: 'active' }, `${tenantName} is active again`)}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {t('Reactivate')}
              </Button>
              <span className="text-[12px] text-blocked-fg">
                {t('Nobody at this tenant can sign in right now.')}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Modules')}
          </span>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModules(enabledModules)}
                disabled={pending}
              >
                {t('Reset')}
              </Button>
            )}
            <Button
              size="sm"
              disabled={pending || !dirty}
              onClick={() => apply({ enabled_modules: modules }, 'Modules updated')}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save modules')}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MODULES.map((name) => {
            const on = modules.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                disabled={pending}
                aria-pressed={on}
                className={cn(
                  'min-h-0 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition',
                  on
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-line-strong bg-surface text-ink-faint hover:text-ink-soft',
                )}
              >
                {moduleLabel(name)}
              </button>
            );
          })}
        </div>
        {modules.length === 0 && (
          <span className="text-[12px] text-blocked-fg">
            {t('With no modules on, the tenant signs in to an empty dashboard.')}
          </span>
        )}
      </div>
    </Card>
  );
}
