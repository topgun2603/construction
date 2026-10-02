'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createContractor } from '@/lib/actions';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';

export function AddContractorDialog() {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState('weekly');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await createContractor({
        name: String(formData.get('name') ?? ''),
        trade: optional(formData.get('trade')),
        phone: optional(formData.get('phone')),
        payment_terms: terms,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not add the contractor');
        return;
      }
      toast.success('Contractor added');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> {t('Add contractor')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Add a contractor')}</DialogTitle>
          <DialogDescription>
            {t('Payment terms set how often accounts generate a wage period for this gang.')}
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <Field label={t('Name')} htmlFor="name">
            <Input id="name" name="name" required placeholder="Murugan Masonry" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Trade')} htmlFor="trade">
              <Input id="trade" name="trade" placeholder={t('Masonry')} />
            </Field>
            <Field label={t('Phone')} htmlFor="phone">
              <Input id="phone" name="phone" inputMode="numeric" placeholder={t('Optional')} />
            </Field>
          </div>
          <Field label={t('Payment terms')}>
            <Select value={terms} onValueChange={setTerms}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">{t('Weekly')}</SelectItem>
                <SelectItem value="fortnightly">{t('Fortnightly')}</SelectItem>
                <SelectItem value="monthly">{t('Monthly')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

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
