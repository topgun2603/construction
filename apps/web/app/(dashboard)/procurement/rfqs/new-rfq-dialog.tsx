'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createRfq } from '@/lib/procurement-actions';
import type { Indent, Material, ProjectSummary } from '@/lib/api-types';
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
import { useLanguage } from '@/components/language-provider';

const SCRATCH = 'scratch';

/**
 * Ask suppliers for prices: from an approved indent, whose lines become the items, or from a list
 * typed here.
 */
export function NewRfqDialog({
  projects,
  materials,
  indents,
}: {
  projects: ProjectSummary[];
  materials: Material[];
  /** Approved indents, any site the caller can see. */
  indents: Indent[];
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(projects[0]?.id ?? '');
  const [source, setSource] = useState(SCRATCH);
  const [items, setItems] = useState([{ key: 1, material_id: '', quantity: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const siteIndents = indents.filter((indent) => indent.project_id === site);

  function submit(formData: FormData) {
    setError(null);
    const title = String(formData.get('title') ?? '').trim();
    if (!title) return setError(t('Give it a title'));
    const fromIndent = source !== SCRATCH;
    const rows = items.filter((item) => item.material_id && item.quantity.trim());
    if (!fromIndent && rows.length === 0) return setError(t('Add at least one item'));
    const notes = String(formData.get('notes') ?? '').trim();
    const requiredBy = String(formData.get('required_by') ?? '').trim();
    start(async () => {
      const result = await createRfq({
        project_id: site,
        title,
        ...(notes ? { notes } : {}),
        ...(requiredBy ? { required_by: requiredBy } : {}),
        ...(fromIndent
          ? { indent_id: source }
          : { items: rows.map((row) => ({ material_id: row.material_id, quantity: row.quantity.trim() })) }),
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not create it'));
        return;
      }
      toast.success(`${result.data.number} ${t('created')}`);
      setOpen(false);
      router.push(`/procurement/rfqs/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {t('Ask for quotes')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('Ask for quotes')}</DialogTitle>
          <DialogDescription>
            {t('List what you need, then enter each supplier’s prices as they come in and compare them side by side.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Site')}>
              <Select
                value={site}
                onValueChange={(value) => {
                  setSite(value);
                  setSource(SCRATCH);
                }}
              >
                <SelectTrigger aria-label={t('Site')}>
                  <SelectValue placeholder={t('Pick a site')} />
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
            <Field label={t('Items from')}>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger aria-label={t('Items from')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SCRATCH}>{t('A list I type')}</SelectItem>
                  {siteIndents.map((indent) => (
                    <SelectItem key={indent.id} value={indent.id}>
                      {t('Indent')} · {indent.items.map((item) => item.material_name).join(', ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('Title')}>
            <Input name="title" maxLength={160} placeholder={t('Cement and steel for the second slab')} />
          </Field>

          {source === SCRATCH && (
            <div className="flex flex-col gap-2">
              {items.map((item) => {
                const unit = materials.find((material) => material.id === item.material_id)?.unit;
                return (
                  <div key={item.key} className="flex items-center gap-2">
                    <Select
                      value={item.material_id}
                      onValueChange={(value) =>
                        setItems((current) =>
                          current.map((row) => (row.key === item.key ? { ...row, material_id: value } : row)),
                        )
                      }
                    >
                      <SelectTrigger aria-label={t('Material')} className="flex-1">
                        <SelectValue placeholder={t('Pick a material')} />
                      </SelectTrigger>
                      <SelectContent>
                        {materials.map((material) => (
                          <SelectItem key={material.id} value={material.id}>
                            {material.name} ({material.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={t('Quantity')}
                      inputMode="decimal"
                      className="w-[110px] text-end font-mono"
                      placeholder={unit ?? t('Qty')}
                      value={item.quantity}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((row) =>
                            row.key === item.key ? { ...row, quantity: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('Remove')}
                      disabled={items.length === 1}
                      onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() =>
                  setItems((current) => [
                    ...current,
                    { key: Math.max(...current.map((row) => row.key)) + 1, material_id: '', quantity: '' },
                  ])
                }
              >
                <Plus className="size-4" /> {t('Add item')}
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
            <Field label={t('Notes for suppliers')} optional>
              <Textarea name="notes" rows={2} maxLength={2000} />
            </Field>
            <Field label={t('Needed by')} optional>
              <Input name="required_by" type="date" />
            </Field>
          </div>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending || !site}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
