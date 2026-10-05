'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle2, Loader2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useLanguage } from '@/components/language-provider';
import { closeSafetyObservation } from '@/lib/safety-actions';
import { uploadSafetyPhoto } from '../../photo-upload';

/** Close an observation with what was done and a photo of it fixed. Completes its open actions. */
export function CloseObservation({ id, projectId }: { id: string; projectId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const note = String(formData.get('note') ?? '').trim();
    start(async () => {
      let key: string | undefined;
      if (photo) {
        const uploaded = await uploadSafetyPhoto(photo, projectId);
        if (!uploaded.ok) return setError(t(uploaded.error));
        key = uploaded.key;
      }
      const result = await closeSafetyObservation(id, {
        ...(note ? { note } : {}),
        ...(key ? { closeout_photo_key: key } : {}),
      });
      if (!result.ok) return setError(result.error ?? t('Could not close it'));
      toast.success(t('Observation closed'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="approve">
          <CheckCircle2 className="size-4" /> {t('Close out')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Close out the observation')}</DialogTitle>
          <DialogDescription>{t('Say what was done, and add a photo of it put right.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('What was done')} htmlFor="close-note" optional>
            <Textarea id="close-note" name="note" rows={3} maxLength={2000} />
          </Field>
          <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed border-line-strong bg-raised text-[13px] text-ink-muted">
            <Camera className="size-5" />
            {photo ? photo.name : t('Close-out photo')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
          </label>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Close out')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
