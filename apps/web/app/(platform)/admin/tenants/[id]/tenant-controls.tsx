'use client';

import { useState, useTransition } from 'react';
import { Loader2, Play, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { updateTenantPlan } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { MODULES, moduleLabel } from './modules';

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
  status,
  enabledModules,
}: {
  tenantId: string;
  tenantName: string;
  plan: string;
  status: string;
  enabledModules: string[];
}) {
  const [pending, start] = useTransition();
  const [modules, setModules] = useState<string[]>(enabledModules);

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Plan
          </span>
          <div className="flex gap-1 rounded-btn bg-neutral-bg p-1">
            {['starter', 'pro'].map((option) => (
              <button
                key={option}
                type="button"
                disabled={pending || plan === option}
                onClick={() =>
                  apply(
                    { plan: option },
                    `${tenantName} moved to ${option === 'pro' ? 'Pro' : 'Starter'}`,
                  )
                }
                className={cn(
                  'min-h-0 rounded-[7px] px-3.5 py-2 text-[13px] font-medium capitalize transition',
                  plan === option
                    ? 'bg-surface font-semibold text-ink shadow-seg'
                    : 'text-ink-soft hover:text-ink',
                )}
              >
                {option}
              </button>
            ))}
          </div>
          {/* Said plainly, because it is the part that surprises people. */}
          <span className="text-[12px] text-ink-muted">
            Changing the plan resets modules to that plan&rsquo;s defaults.
          </span>
        </div>

        <div className="flex flex-col items-start gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Account
          </span>
          {status === 'active' ? (
            <ConfirmDialog
              title="Suspend this account?"
              body={
                <>
                  Everyone at <strong className="font-semibold text-ink">{tenantName}</strong> is
                  signed out within seconds and cannot file attendance, reports or expenses until
                  you switch it back. Their data is untouched.
                </>
              }
              confirmLabel="Suspend account"
              successMessage={`${tenantName} suspended`}
              onConfirm={() => updateTenantPlan({ tenantId, status: 'suspended' })}
              trigger={
                <Button variant="destructive" size="sm" disabled={pending}>
                  <ShieldAlert className="size-4" />
                  Suspend
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
                Reactivate
              </Button>
              <span className="text-[12px] text-blocked-fg">
                Nobody at this tenant can sign in right now.
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Modules
          </span>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModules(enabledModules)}
                disabled={pending}
              >
                Reset
              </Button>
            )}
            <Button
              size="sm"
              disabled={pending || !dirty}
              onClick={() => apply({ enabled_modules: modules }, 'Modules updated')}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save modules
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
            With no modules on, the tenant signs in to an empty dashboard.
          </span>
        )}
      </div>
    </Card>
  );
}
