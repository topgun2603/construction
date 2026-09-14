'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PLANS, PLAN_LABELS } from '@sitebook/shared';
import { createTenantFromConsole } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Creating an account nobody signed up for.
 *
 * The ordinary path is a builder signing in with their number and onboarding themselves, and it
 * stays the primary one. This is for the calls that do not go that way: a customer who paid by
 * cheque and wants the account waiting, a demo for a sales conversation, an account recreated after
 * a mistake.
 *
 * No password is set and no message is sent, because the product has neither. The owner's number
 * becomes a working login the first time they pass OTP with it — so the operator's last job is to
 * tell them, out of band, that it is ready.
 */
export function NewTenantDialog({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState('three_months');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Hidden rather than disabled for a non-root operator: the server refuses it, and a button that
  // always fails teaches people to distrust the screen.
  if (!canCreate) return null;

  function submit(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await createTenantFromConsole({
        name: String(formData.get('name') ?? '').trim(),
        owner_name: String(formData.get('owner_name') ?? '').trim(),
        owner_phone: String(formData.get('owner_phone') ?? '').trim(),
        plan,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not create the account');
        return;
      }
      toast.success('Account created');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> New account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            For a customer who is not signing up themselves. They sign in with the owner&apos;s
            number — nothing is sent, so tell them it is ready.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="flex flex-col gap-4">
          <Field label="Company" htmlFor="name">
            <Input id="name" name="name" required minLength={2} placeholder="Green Acres LLP" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner" htmlFor="owner_name">
              <Input id="owner_name" name="owner_name" required placeholder="Gowtham Kumar" />
            </Field>
            <Field label="Owner's mobile" htmlFor="owner_phone">
              <Input
                id="owner_phone"
                name="owner_phone"
                inputMode="numeric"
                required
                placeholder="98765 43210"
              />
            </Field>
          </div>

          <Field label="Plan">
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {PLAN_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
