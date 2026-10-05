'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { taxRule } from '@sitebook/shared';
import { createVendor, updateVendor } from '@/lib/procurement-actions';
import type { Vendor } from '@/lib/procurement-types';
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
import { PhoneInput } from '@/components/phone-input';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';

/**
 * Add a supplier, or edit one. The tax number is checked against the company's regime by the API
 * — a GSTIN in India, a TRN in the UAE — and refused rather than stored when it cannot be real.
 */
export function VendorFormDialog({ vendor, trigger }: { vendor?: Vendor; trigger?: ReactNode }) {
  const { t } = useLanguage();
  const { settings } = useFormat();
  const router = useRouter();
  const idLabel = taxRule(settings.taxRegime ?? 'none').idLabel;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const text = (key: string) => {
      const value = String(formData.get(key) ?? '').trim();
      return value === '' ? null : value;
    };
    const name = text('name');
    if (!name) return setError(t('Give the supplier a name'));
    const terms = text('payment_terms_days');
    const phone = text('phone');
    const input = {
      name,
      contact_name: text('contact_name'),
      // An edit with the phone box left empty keeps the number on file.
      ...(phone || !vendor ? { phone } : {}),
      email: text('email'),
      address: text('address'),
      ...(idLabel ? { tax_id: text('tax_id') } : {}),
      payment_terms_days: terms === null ? null : Number(terms),
      notes: text('notes'),
    };
    start(async () => {
      const result = vendor ? await updateVendor(vendor.id, input) : await createVendor(input);
      if (!result.ok) {
        setError(result.error ?? t('Could not save the supplier'));
        return;
      }
      toast.success(vendor ? t('Supplier updated') : t('Supplier added'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-4" /> {t('Add supplier')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{vendor ? `${t('Edit')} ${vendor.name}` : t('Add a supplier')}</DialogTitle>
          <DialogDescription>{t('Who you buy materials from. Used on quotes, orders and invoices.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Name')}>
            <Input name="name" maxLength={160} defaultValue={vendor?.name ?? ''} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Contact person')} optional>
              <Input name="contact_name" maxLength={120} defaultValue={vendor?.contact_name ?? ''} />
            </Field>
            <Field
              label={t('Phone')}
              optional
              {...(vendor?.phone ? { hint: `${t('On file')}: +${vendor.phone}` } : {})}
            >
              <PhoneInput name="phone" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Email')} optional>
              <Input name="email" type="email" maxLength={200} defaultValue={vendor?.email ?? ''} />
            </Field>
            {idLabel && (
              <Field label={idLabel} optional>
                <Input name="tax_id" maxLength={30} className="font-mono uppercase" defaultValue={vendor?.tax_id ?? ''} />
              </Field>
            )}
          </div>
          <Field label={t('Address')} optional>
            <Textarea name="address" rows={2} maxLength={500} defaultValue={vendor?.address ?? ''} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <Field label={t('Payment terms (days)')} optional>
              <Input
                name="payment_terms_days"
                inputMode="numeric"
                defaultValue={vendor?.payment_terms_days === null || !vendor ? '' : String(vendor.payment_terms_days)}
              />
            </Field>
            <Field label={t('Notes')} optional>
              <Input name="notes" maxLength={1000} defaultValue={vendor?.notes ?? ''} />
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
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
