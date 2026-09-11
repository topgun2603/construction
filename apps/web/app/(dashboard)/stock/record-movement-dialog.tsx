'use client';

import { useState, useTransition } from 'react';
import { Loader2, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { recordStockMovement } from '@/lib/actions';
import type { Material, ProjectSummary } from '@/lib/api-types';
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
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Record material arriving or leaving by hand.
 *
 * Most inward movement comes from receiving an indent, which books stock in on its own. This is
 * for the rest: a cash purchase nobody raised an indent for, and every issue to the site — which
 * has no other route in.
 *
 * Direction is a two-way switch rather than a dropdown, because it is the field most likely to be
 * got wrong and the consequence is a stock figure that reads backwards.
 */
export function RecordMovementDialog({
  projectId,
  projects,
  materials,
}: {
  projectId: string;
  projects: ProjectSummary[];
  materials: Material[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'in' | 'out'>('in');
  const [site, setSite] = useState(projectId);
  const [materialId, setMaterialId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const unit = materials.find((material) => material.id === materialId)?.unit ?? '';

  function submit(formData: FormData) {
    setError(null);
    if (!materialId) {
      setError('Pick a material');
      return;
    }
    const quantity = String(formData.get('quantity') ?? '').trim();
    if (!quantity) {
      setError('Enter a quantity');
      return;
    }

    start(async () => {
      const note = String(formData.get('note') ?? '').trim();
      const ref = String(formData.get('ref') ?? '').trim();
      const result = await recordStockMovement({
        project_id: site,
        material_id: materialId,
        type,
        quantity,
        moved_on: String(formData.get('moved_on') ?? todayIso()),
        ...(ref ? { ref } : {}),
        ...(note ? { note } : {}),
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not record that');
        return;
      }
      toast.success(type === 'in' ? 'Material booked in' : 'Issue recorded');
      setOpen(false);
      setMaterialId('');
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PackagePlus className="size-4" />
          Record movement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Record a stock movement</DialogTitle>
          <DialogDescription>
            Receiving an approved indent books material in for you. Use this for a direct purchase,
            or to issue material to the site.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="flex flex-col gap-4">
          <div
            className="flex gap-1 rounded-btn bg-neutral-bg p-1"
            role="group"
            aria-label="Direction"
          >
            {(
              [
                { value: 'in', label: 'Came in' },
                { value: 'out', label: 'Went out to site' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={type === option.value}
                onClick={() => setType(option.value)}
                className={cn(
                  'min-h-0 flex-1 rounded-[7px] px-3 py-2 text-[13px] font-medium transition',
                  type === option.value
                    ? 'bg-surface font-semibold text-ink shadow-seg'
                    : 'text-ink-soft hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {projects.length > 1 && (
            <Field label="Site">
              <Select value={site} onValueChange={setSite}>
                <SelectTrigger aria-label="Site">
                  <SelectValue placeholder="Pick a site" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Material">
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger aria-label="Material">
                <SelectValue placeholder="Pick a material" />
              </SelectTrigger>
              <SelectContent>
                {materials.map((material) => (
                  <SelectItem key={material.id} value={material.id}>
                    {material.name} ({material.unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex flex-wrap gap-3">
            <Field
              label={unit ? `Quantity (${unit})` : 'Quantity'}
              hint="Up to three decimals"
              className="min-w-[150px] flex-1"
            >
              <Input name="quantity" inputMode="decimal" placeholder="40" />
            </Field>
            <Field label="Date" className="w-[170px]">
              <Input name="moved_on" type="date" defaultValue={todayIso()} />
            </Field>
          </div>

          <Field label={type === 'in' ? 'Challan or bill number' : 'Reference'} hint="Optional">
            <Input name="ref" maxLength={80} placeholder={type === 'in' ? 'CH-10482' : ''} />
          </Field>

          <Field label="Note" hint="Optional">
            <Textarea name="note" rows={2} maxLength={500} />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {type === 'in' ? 'Book in' : 'Record issue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
