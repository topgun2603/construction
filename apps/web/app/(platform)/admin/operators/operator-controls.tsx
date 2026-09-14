'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { grantOperator, revokeOperator } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';

interface Operator {
  phone: string;
  name: string | null;
  granted_by: string | null;
  granted_at: string | null;
}

/**
 * The granted operators, and the form that adds one.
 *
 * `canManage` is false for an operator who is not root. The controls are hidden rather than shown
 * and refused: a button that always fails teaches people to distrust the whole screen.
 */
export function OperatorControls({
  granted,
  canManage,
}: {
  granted: Operator[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add(formData: FormData) {
    setError(null);
    const phone = String(formData.get('phone') ?? '').trim();
    if (!phone) {
      setError('Enter a mobile number');
      return;
    }

    start(async () => {
      const name = String(formData.get('name') ?? '').trim();
      const result = await grantOperator({ phone, ...(name ? { name } : {}) });
      if (!result.ok) {
        setError(result.error ?? 'Could not grant access');
        return;
      }
      toast.success('Access granted');
      setAdding(false);
    });
  }

  function revoke(operator: Operator) {
    start(async () => {
      const result = await revokeOperator(operator.phone);
      if (result.ok) toast.success('Access withdrawn');
      else toast.error(result.error ?? 'Could not withdraw access');
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Granted from here
        </h2>
        {canManage && !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add operator
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-panel border border-line bg-surface">
        {granted.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nobody else has access"
              body={
                canManage
                  ? 'Add a support person here rather than sharing the number in the deployment config around.'
                  : 'Only the numbers in the deployment config can open this console.'
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {granted.map((operator) => (
              <li key={operator.phone} className="flex items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-[14px]">+{operator.phone}</span>
                  <span className="text-[12px] text-ink-muted">
                    {[
                      operator.name,
                      operator.granted_by
                        ? `added by +${operator.granted_by}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-8 text-ink-faint hover:text-blocked-fg"
                    onClick={() => revoke(operator)}
                    disabled={pending}
                    aria-label={`Withdraw access for ${operator.phone}`}
                    title="Withdraw access"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <form
            action={add}
            className="flex flex-wrap items-end gap-3 border-t border-line-soft bg-raised px-4 py-3"
          >
            <Field label="Mobile number" htmlFor="phone" className="w-[190px]">
              <Input id="phone" name="phone" inputMode="numeric" placeholder="98765 43210" />
            </Field>
            <Field label="Name" htmlFor="name" optional className="min-w-[160px] flex-1">
              <Input id="name" name="name" placeholder="Who this is" />
            </Field>
            <div className="flex items-center gap-2 pb-0.5">
              <Button type="submit" size="sm" disabled={pending}>
                Grant access
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
            {error && (
              <p role="alert" className="w-full text-[13px] text-blocked-fg">
                {error}
              </p>
            )}
          </form>
        )}
      </div>

      <p className="text-[12.5px] text-ink-faint">
        A granted operator can do everything in this console except add or remove another operator.
      </p>
    </section>
  );
}
