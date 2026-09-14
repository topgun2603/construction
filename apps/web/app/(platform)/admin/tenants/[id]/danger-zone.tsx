'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, LifeBuoy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteTenant } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

/**
 * The three things an operator does that are not a plan change: look at what a customer is seeing,
 * hand them their data, and close the account.
 *
 * Deliberately at the bottom of the page and visually apart. Two of these are irreversible in the
 * ordinary sense — an export leaves the building, a deletion cannot be undone — and neither should
 * sit next to the module toggles somebody flips several times a day.
 */
export function DangerZone({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Compared trimmed, because a name copied off the page above brings whitespace with it — and
  // this guard exists to prove the operator read the row, not to test their typing.
  const armed = confirmName.trim() === tenantName.trim();

  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteTenant({ tenantId, confirmName: confirmName.trim() });
      if (!result.ok) {
        setError(result.error ?? 'Could not delete this account');
        return;
      }
      toast.success(`${tenantName} deleted`);
      router.push('/admin/tenants');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <LifeBuoy className="size-4 text-ink-muted" aria-hidden />
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium">Support view</span>
          <span className="text-[12.5px] text-ink-muted">
            Who can sign in, what the plan allows, and what has been filed lately
          </span>
        </div>
        <Button asChild size="sm" variant="secondary" className="ml-auto">
          <a href={`/admin/tenants/${tenantId}/support`}>Open</a>
        </Button>
      </Card>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Download className="size-4 text-ink-muted" aria-hidden />
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium">Export everything</span>
          <span className="text-[12.5px] text-ink-muted">
            A JSON file of every row this account owns. Photographs are referenced by key, not
            embedded.
          </span>
        </div>
        {/*
          A plain link, not a fetch: the API answers with the whole export, and the browser is
          better at saving a large response than the page is at holding one in memory.
        */}
        <Button asChild size="sm" variant="secondary" className="ml-auto">
          <a href={`/admin/tenants/${tenantId}/export`} download>
            Download
          </a>
        </Button>
      </Card>

      <Card className="flex flex-col gap-3 border-blocked-fg/30 p-4">
        <div className="flex items-center gap-2">
          <Trash2 className="size-4 text-blocked-fg" aria-hidden />
          <span className="text-[14px] font-medium text-blocked-fg">Delete this account</span>
        </div>
        <p className="text-[13px] text-ink-muted">
          Removes {tenantName} and everything under it — sites, workers, attendance, wages,
          photographs. This cannot be undone. If you only need to stop them using the product,
          suspend the account instead: that is reversible and keeps their data.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={`Type ${tenantName} to confirm`}
            htmlFor="confirm_name"
            className="min-w-[240px] flex-1"
          >
            <Input
              id="confirm_name"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              placeholder={tenantName}
              autoComplete="off"
            />
          </Field>
          <div className="pb-0.5">
            <Button variant="destructive" size="sm" disabled={!armed || pending} onClick={remove}>
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-blocked-fg">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}
