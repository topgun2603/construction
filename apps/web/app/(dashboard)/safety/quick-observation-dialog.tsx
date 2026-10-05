'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SAFETY_CATEGORY_LABELS, SAFETY_OBSERVATION_TYPE_LABELS, type SafetyCategory } from '@sitebook/shared';
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
import { useLanguage } from '@/components/language-provider';
import { quickSafetyObservation } from '@/lib/safety-actions';
import { uploadSafetyPhoto } from './photo-upload';
import { SitePicker } from './site-picker';

/**
 * Quick capture: a photo and a few words, from a phone, in under ten seconds. The type, category and
 * severity are suggested from the words — by the AI when the company has it switched on, by keyword
 * rules when not — and can be corrected on the observation afterwards.
 */
export function QuickObservationDialog({
  sites,
  fixedSiteId,
  trigger,
}: {
  sites: Array<{ id: string; name: string }>;
  fixedSiteId?: string;
  trigger?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? sites[0]?.id ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const note = String(formData.get('note') ?? '').trim();
    const location = String(formData.get('location') ?? '').trim();
    if (!siteId) return setError(t('Choose the site'));
    if (!note) return setError(t('Say in a few words what you saw'));
    start(async () => {
      let photoKey: string | undefined;
      if (photo) {
        const uploaded = await uploadSafetyPhoto(photo, siteId);
        if (!uploaded.ok) return setError(t(uploaded.error));
        photoKey = uploaded.key;
      }
      const result = await quickSafetyObservation({
        project_id: siteId,
        note,
        ...(photoKey ? { photo_key: photoKey } : {}),
        ...(location ? { location } : {}),
        client_id: crypto.randomUUID(),
      });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not save it'));
      const saved = result.data.observation;
      toast.success(
        `${saved.number}: ${t(SAFETY_OBSERVATION_TYPE_LABELS[saved.type])} · ${t(
          SAFETY_CATEGORY_LABELS[saved.category as SafetyCategory] ?? saved.category,
        )}`,
        { description: result.data.suggestion ? t('Suggested from your note — open it to correct anything.') : undefined },
      );
      setOpen(false);
      setPhoto(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="secondary">
            <Eye className="size-4" />
            {t('Quick observation')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Quick observation')}</DialogTitle>
          <DialogDescription>
            {t('A photo and a few words. We suggest whether it is an unsafe act or condition, and how serious.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
          <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed border-line-strong bg-raised text-[13px] text-ink-muted">
            <Camera className="size-6" />
            {photo ? photo.name : t('Take or choose a photo')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
          </label>
          <Field label={t('What did you see?')} htmlFor="obs-note">
            <Textarea
              id="obs-note"
              name="note"
              rows={3}
              maxLength={2000}
              required
              placeholder={t('Worker on the slab edge without a harness')}
            />
          </Field>
          <Field label={t('Where')} htmlFor="obs-location" optional>
            <Input id="obs-location" name="location" maxLength={200} placeholder={t('Block A, level 3')} />
          </Field>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Record observation')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
