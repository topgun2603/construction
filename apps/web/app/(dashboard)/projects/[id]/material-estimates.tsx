'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus, Trash2, Warehouse } from 'lucide-react';
import { toast } from 'sonner';
import { removeMaterialEstimate, setMaterialEstimates } from '@/lib/actions';
import type { Material, MaterialEstimate } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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
 * What this site is expected to consume — the figure the overrun report measures against.
 *
 * Edited one material at a time rather than as a bulk grid. A bill of quantities arrives in
 * pieces and gets revised in pieces, and a save-everything form makes a revision to one line look
 * like a decision about every other.
 *
 * Estimates are upserted per material, so adding a row never disturbs the rest.
 */
export function MaterialEstimates({
  projectId,
  estimates,
  materials,
  canEdit,
}: {
  projectId: string;
  estimates: MaterialEstimate[];
  materials: Material[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [materialId, setMaterialId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Materials already estimated are dropped from the picker: a second row for the same cement
  // would make "expected" a question rather than a figure, and the API refuses it anyway.
  const available = materials.filter(
    (material) => !estimates.some((estimate) => estimate.material_id === material.id),
  );
  const unit = materials.find((material) => material.id === materialId)?.unit ?? '';

  function add(formData: FormData) {
    setError(null);
    if (!materialId) {
      setError('Pick a material');
      return;
    }
    const quantity = String(formData.get('estimated_quantity') ?? '').trim();
    if (!quantity) {
      setError('Enter the expected quantity');
      return;
    }
    const note = String(formData.get('note') ?? '').trim();

    start(async () => {
      const result = await setMaterialEstimates({
        projectId,
        items: [
          { material_id: materialId, estimated_quantity: quantity, ...(note ? { note } : {}) },
        ],
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not save that');
        return;
      }
      toast.success('Estimate saved');
      setMaterialId('');
      setAdding(false);
    });
  }

  function revise(estimate: MaterialEstimate, quantity: string) {
    if (quantity.trim() === estimate.estimated_quantity) return;
    start(async () => {
      const result = await setMaterialEstimates({
        projectId,
        items: [{ material_id: estimate.material_id, estimated_quantity: quantity.trim() }],
      });
      if (result.ok) toast.success(`${estimate.material_name} revised`);
      else toast.error(result.error ?? 'Could not revise that');
    });
  }

  function drop(estimate: MaterialEstimate) {
    start(async () => {
      const result = await removeMaterialEstimate({
        projectId,
        materialId: estimate.material_id,
      });
      if (result.ok) toast.success(`${estimate.material_name} removed`);
      else toast.error(result.error ?? 'Could not remove that');
    });
  }

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Expected consumption
          </span>
          <span className="text-[12.5px] text-ink-muted">
            What the overrun report measures this site against
          </span>
        </div>
        {canEdit && !adding && available.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add material
          </Button>
        )}
      </div>

      {estimates.length === 0 && !adding ? (
        <div className="p-4">
          <EmptyState
            icon={<Warehouse />}
            title="No estimates set for this site"
            body="Enter how much of each material the job should take — from the bill of quantities, or from experience. Until then there is nothing for consumption to be measured against."
            action={
              canEdit && available.length > 0 ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="size-4" />
                  Add the first material
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line-soft">
          {estimates.map((estimate) => (
            <li
              key={estimate.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-medium">{estimate.material_name}</span>
                <span className="text-[12px] text-ink-muted">
                  {[estimate.category, estimate.note].filter(Boolean).join(' · ') || estimate.unit}
                </span>
              </div>
              <div className="flex flex-none items-center gap-2">
                {canEdit ? (
                  <>
                    {/*
                      Committed on blur rather than on every keystroke: a quantity is typed a
                      character at a time, and saving "1" on the way to "150" would have the
                      overrun report briefly claim the site is 149 bags over.
                    */}
                    <Input
                      defaultValue={estimate.estimated_quantity}
                      onBlur={(event) => revise(estimate, event.target.value)}
                      inputMode="decimal"
                      className="h-9 w-[110px] text-right font-mono"
                      aria-label={`Expected ${estimate.material_name}`}
                      disabled={pending}
                    />
                    <span className="w-12 text-[12.5px] text-ink-muted">{estimate.unit}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-ink-faint hover:text-blocked-fg"
                      onClick={() => drop(estimate)}
                      disabled={pending}
                      aria-label={`Remove ${estimate.material_name}`}
                      title="Remove this estimate"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                ) : (
                  <span className="font-mono text-[14px] font-semibold">
                    {estimate.estimated_quantity}{' '}
                    <span className="text-[12px] font-normal text-ink-muted">{estimate.unit}</span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form
          action={add}
          className="flex flex-col gap-3 border-t border-line-soft bg-raised px-4 py-3"
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Material" className="min-w-[200px] flex-1">
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger aria-label="Material">
                  <SelectValue placeholder="Pick a material" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.name} ({material.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={unit ? `Expected (${unit})` : 'Expected'} className="w-[150px]">
              <Input name="estimated_quantity" inputMode="decimal" placeholder="150" />
            </Field>
            <Field label="Note" optional className="min-w-[160px] flex-1">
              <Input name="note" maxLength={200} placeholder="Ground floor slab" />
            </Field>
            <div className="flex items-center gap-2 pb-0.5">
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
