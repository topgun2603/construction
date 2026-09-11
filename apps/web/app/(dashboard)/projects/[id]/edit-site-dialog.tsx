'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { PROJECT_STATUSES } from '@sitebook/shared';
import { updateProject } from '@/lib/actions';
import type { ProjectSummary } from '@/lib/api-types';
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
import { LocationField } from '@/components/location-field';
import { paiseToRupeesInput, rupeesToPaiseString } from '@/lib/money-input';
import { statusLabel } from '@/lib/projects';

/**
 * Editing a site.
 *
 * One dialog for every detail including the location, rather than a separate control per field. There
 * were briefly two ways to change the address — this one and a location-only dialog beside the map —
 * which is how two code paths end up writing the same column and disagreeing about what "clear it"
 * means. The map's button opens this same dialog.
 *
 * Only changed fields are sent. A PATCH carrying every value would overwrite whatever somebody else
 * edited while this dialog sat open, and on a site that several people manage that is a real loss
 * rather than a theoretical one.
 */
export function EditSiteDialog({
  project,
  trigger,
}: {
  project: ProjectSummary;
  /** The map beside this passes its own button, so both routes lead to one dialog. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [form, setForm] = useState({
    name: project.name,
    client_name: project.client_name ?? '',
    address: project.address ?? '',
    start_date: project.start_date ?? '',
    target_end_date: project.target_end_date ?? '',
    budget: project.budget_amount ? paiseToRupeesInput(project.budget_amount) : '',
    status: project.status,
  });
  const [coords, setCoords] = useState({
    lat: project.lat === null ? '' : String(project.lat),
    lng: project.lng === null ? '' : String(project.lng),
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setError(null);

    if (form.name.trim().length < 2) {
      setError('The site needs a name');
      return;
    }
    if (form.start_date && form.target_end_date && form.target_end_date < form.start_date) {
      setError('Handover cannot be before the start date');
      return;
    }

    const lat = Number.parseFloat(coords.lat);
    const lng = Number.parseFloat(coords.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    // Half a coordinate is not half a location — it is a point in the sea off West Africa.
    if ((coords.lat.trim() || coords.lng.trim()) && !hasCoords) {
      setError('Enter both a latitude and a longitude, or neither');
      return;
    }

    // Only what actually changed. `null` clears a field; leaving the key out means "unchanged".
    const patch: Record<string, unknown> = {};
    if (form.name.trim() !== project.name) patch['name'] = form.name.trim();
    if (form.client_name.trim() !== (project.client_name ?? '')) {
      patch['client_name'] = form.client_name.trim() || null;
    }
    if (form.address.trim() !== (project.address ?? '')) {
      patch['address'] = form.address.trim() || null;
    }
    if (form.start_date !== (project.start_date ?? '')) {
      patch['start_date'] = form.start_date || null;
    }
    if (form.target_end_date !== (project.target_end_date ?? '')) {
      patch['target_end_date'] = form.target_end_date || null;
    }
    if (form.status !== project.status) patch['status'] = form.status;

    const budgetPaise = form.budget.trim() ? rupeesToPaiseString(form.budget.trim()) : null;
    if (budgetPaise !== (project.budget_amount ?? null)) patch['budget_amount'] = budgetPaise;

    if (hasCoords && (lat !== project.lat || lng !== project.lng)) {
      patch['lat'] = lat;
      patch['lng'] = lng;
    }

    if (Object.keys(patch).length === 0) {
      setOpen(false);
      return;
    }

    start(async () => {
      const result = await updateProject({ projectId: project.id, patch });
      if (!result.ok) {
        setError(result.error ?? 'Could not save the changes');
        return;
      }
      toast.success('Site updated');
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <Pencil className="size-4" />
            Edit site
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Edit {project.name}</DialogTitle>
          <DialogDescription>
            Everything about the site itself. Milestones, team and materials are edited on their own
            tabs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-3">
            <Field label="Site name" className="min-w-[220px] flex-1">
              <Input
                value={form.name}
                onChange={(event) => set('name', event.target.value)}
                maxLength={160}
                autoFocus
              />
            </Field>
            <Field label="Client" className="min-w-[180px] flex-1">
              <Input
                value={form.client_name}
                onChange={(event) => set('client_name', event.target.value)}
                placeholder="Optional"
                maxLength={160}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3">
            <Field label="Start date" className="w-[170px]">
              <Input
                type="date"
                value={form.start_date}
                onChange={(event) => set('start_date', event.target.value)}
              />
            </Field>
            <Field label="Handover" className="w-[170px]">
              <Input
                type="date"
                value={form.target_end_date}
                onChange={(event) => set('target_end_date', event.target.value)}
              />
            </Field>
            <Field label="Budget" hint="Rupees" className="min-w-[150px] flex-1">
              <Input
                value={form.budget}
                onChange={(event) => set('budget', event.target.value)}
                inputMode="numeric"
                placeholder="42000000"
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label="Status"
            hint={
              form.status === 'on_hold'
                ? 'A stopped site floats to the top of the overview so it is not forgotten'
                : undefined
            }
            className="w-[220px]"
          >
            <Select value={form.status} onValueChange={(value) => set('status', value)}>
              <SelectTrigger aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Location
            </span>
            <Field label="Address" hint="What you would tell a driver">
              <Input
                value={form.address}
                onChange={(event) => set('address', event.target.value)}
                placeholder="Survey 42, Whitefield Main Road"
                maxLength={300}
              />
            </Field>
            <LocationField lat={coords.lat} lng={coords.lng} onChange={setCoords} />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
