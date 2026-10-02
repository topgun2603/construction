'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createMaterial } from '@/lib/actions';
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
import { useLanguage } from '@/components/language-provider';

export function AddMaterialDialog() {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await createMaterial({
        name: String(formData.get('name') ?? ''),
        unit: String(formData.get('unit') ?? ''),
        category: optional(formData.get('category')),
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not add the material');
        return;
      }
      toast.success('Added to the catalogue');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> {t('Add material')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Add a material')}</DialogTitle>
          <DialogDescription>
            {t('The unit is what indents are counted in — bag, MT, nos, kg.')}
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <Field label={t('Name')} htmlFor="name">
            <Input id="name" name="name" required placeholder={t('OPC 53 Grade Cement')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Unit')} htmlFor="unit">
              <Input id="unit" name="unit" required placeholder="bag" />
            </Field>
            <Field label={t('Category')} htmlFor="category">
              <Input id="category" name="category" placeholder={t('Cement')} />
            </Field>
          </div>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : t('Add')}
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
