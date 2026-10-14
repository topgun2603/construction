'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { updateRfiSettings } from '@/lib/rfi-actions';
import type { RfiSettings } from '@/lib/rfi-types';

/** The company's defaults for RFIs and submittals: days to answer, days to review, reminders. */
export function RfiSettingsDialog({ settings }: { settings: RfiSettings }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const number = (name: string) => Number.parseInt(String(formData.get(name) ?? ''), 10);
    start(async () => {
      const result = await updateRfiSettings({
        rfi_due_days: number('rfi_due_days'),
        submittal_review_days: number('submittal_review_days'),
        reminder_days_before: number('reminder_days_before'),
      });
      if (!result.ok) return setError(result.error ?? t('Could not save it'));
      toast.success(t('Defaults saved'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Settings2 className="size-4" />
          {t('Defaults')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('RFI and submittal defaults')}</DialogTitle>
          <DialogDescription>
            {t('Used when an RFI or submittal is sent without a due date of its own.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Days for the designer to answer an RFI')} htmlFor="rfi-days">
            <Input id="rfi-days" name="rfi_due_days" type="number" min={1} max={90} defaultValue={settings.rfi_due_days} />
          </Field>
          <Field label={t('Days for a reviewer to review a submittal')} htmlFor="sub-days">
            <Input
              id="sub-days"
              name="submittal_review_days"
              type="number"
              min={1}
              max={120}
              defaultValue={settings.submittal_review_days}
            />
          </Field>
          <Field label={t('Remind this many days before the due date')} htmlFor="remind-days">
            <Input
              id="remind-days"
              name="reminder_days_before"
              type="number"
              min={0}
              max={14}
              defaultValue={settings.reminder_days_before}
            />
          </Field>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
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
