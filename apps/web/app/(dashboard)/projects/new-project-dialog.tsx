'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createProject } from '@/lib/actions';
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
import { rupeesToPaiseString } from '@/lib/money-input';
import { LocationField } from '@/components/location-field';

export function NewProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState({ lat: '', lng: '' });
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      const budget = String(formData.get('budget') ?? '').trim();

      /*
       * Sent as numbers, and only when both are present. A latitude without a longitude is not half a
       * location — it is a point in the sea off West Africa, which is exactly what a map would show.
       */
      const lat = Number.parseFloat(location.lat);
      const lng = Number.parseFloat(location.lng);
      const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

      const result = await createProject({
        name: String(formData.get('name') ?? ''),
        client_name: optional(formData.get('client_name')),
        address: optional(formData.get('address')),
        start_date: optional(formData.get('start_date')),
        target_end_date: optional(formData.get('target_end_date')),
        ...(budget ? { budget_amount: rupeesToPaiseString(budget) } : {}),
        ...(hasLocation ? { lat, lng } : {}),
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not create the site');
        return;
      }
      toast.success('Site created');
      setOpen(false);
      if (result.data?.id) router.push(`/projects/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> New site
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New site</DialogTitle>
          <DialogDescription>
            You can add the team, milestones and budget later.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <Field label="Site name" htmlFor="name">
            <Input id="name" name="name" required minLength={2} placeholder="Lakeview Tower" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="client_name">
              <Input id="client_name" name="client_name" placeholder="Optional" />
            </Field>
            <Field label="Budget (₹)" htmlFor="budget" hint="Whole rupees">
              <Input id="budget" name="budget" inputMode="numeric" placeholder="42000000" />
            </Field>
          </div>
          <Field label="Address" htmlFor="address">
            <Input id="address" name="address" placeholder="Optional" />
          </Field>

          <LocationField lat={location.lat} lng={location.lng} onChange={setLocation} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="start_date">
              <Input id="start_date" name="start_date" type="date" />
            </Field>
            <Field label="Target handover" htmlFor="target_end_date">
              <Input id="target_end_date" name="target_end_date" type="date" />
            </Field>
          </div>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create site'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : undefined;
}
