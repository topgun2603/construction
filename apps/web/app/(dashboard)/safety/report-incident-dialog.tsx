'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2, Siren } from 'lucide-react';
import { toast } from 'sonner';
import {
  SAFETY_INCIDENT_TYPES,
  SAFETY_INCIDENT_TYPE_LABELS,
  safetyIsSerious,
  type SafetyIncidentType,
} from '@sitebook/shared';
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
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { reportSafetyIncident, safetySiteWorkers } from '@/lib/safety-actions';
import { localNow } from './labels';
import { uploadSafetyPhoto } from './photo-upload';
import { OptionSelect, SitePicker } from './site-picker';

const NOBODY = '__none__';
const SOMEONE_ELSE = '__other__';

/**
 * Report an incident or a near miss from a phone. Only what is known in the first minutes is asked
 * for — what happened, when, where, who was hurt and what was done on the spot. The investigation
 * (root cause, actions) comes later, on the incident's own page.
 */
export function ReportIncidentDialog({
  sites,
  fixedSiteId,
}: {
  sites: Array<{ id: string; name: string }>;
  fixedSiteId?: string;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? sites[0]?.id ?? '');
  const [type, setType] = useState<SafetyIncidentType>('near_miss');
  const [workers, setWorkers] = useState<Array<{ id: string; name: string; trade: string | null }>>([]);
  const [injured, setInjured] = useState(NOBODY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tz = format.settings.timezone;

  useEffect(() => {
    if (!open || !siteId) return;
    let live = true;
    void safetySiteWorkers(siteId).then((result) => {
      if (live) setWorkers(result.ok ? (result.data ?? []) : []);
    });
    return () => {
      live = false;
    };
  }, [open, siteId]);

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId) return setError(t('Choose the site'));
    const occurred = read('occurred_at');
    if (!occurred) return setError(t('When did it happen?'));
    const otherName = read('other_name');
    const person =
      injured === NOBODY
        ? null
        : {
            ...(injured === SOMEONE_ELSE ? { name: otherName } : { worker_id: injured }),
            role: 'injured' as const,
            ...(read('body_part') ? { body_part: read('body_part') } : {}),
            ...(read('injury_nature') ? { injury_nature: read('injury_nature') } : {}),
          };
    if (injured === SOMEONE_ELSE && !otherName) return setError(t('Type the name of the person hurt'));
    start(async () => {
      let photoKey: string | undefined;
      if (photo) {
        const uploaded = await uploadSafetyPhoto(photo, siteId);
        if (!uploaded.ok) return setError(t(uploaded.error));
        photoKey = uploaded.key;
      }
      const result = await reportSafetyIncident({
        project_id: siteId,
        occurred_at: occurred,
        type,
        title: read('title'),
        ...(read('location') ? { location: read('location') } : {}),
        ...(read('description') ? { description: read('description') } : {}),
        ...(read('immediate_action') ? { immediate_action: read('immediate_action') } : {}),
        ...(person ? { people: [person] } : {}),
        ...(photoKey ? { photo_keys: [photoKey] } : {}),
        client_id: crypto.randomUUID(),
      });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not save the report'));
      toast.success(`${result.data.number} ${t('reported')}`, {
        description: result.data.serious ? t('The owners have been alerted.') : undefined,
      });
      setOpen(false);
      setPhoto(null);
      router.push(`/safety/incidents/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Siren className="size-4" />
          {t('Report incident')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Report an incident or near miss')}</DialogTitle>
          <DialogDescription>
            {t('What you know now. The investigation and the fixes are added on the incident afterwards.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
            <OptionSelect
              label={t('What kind')}
              value={type}
              onChange={(value) => setType(value as SafetyIncidentType)}
              options={SAFETY_INCIDENT_TYPES.map((value) => ({ value, label: SAFETY_INCIDENT_TYPE_LABELS[value] }))}
            />
            <Field label={t('When')} htmlFor="inc-when" hint={t('On the company clock')}>
              <Input
                id="inc-when"
                name="occurred_at"
                type="datetime-local"
                required
                defaultValue={localNow(tz)}
                max={localNow(tz, 5)}
                dir="ltr"
              />
            </Field>
            <Field label={t('Where')} htmlFor="inc-where" optional>
              <Input id="inc-where" name="location" maxLength={200} placeholder={t('Block B, level 2')} />
            </Field>
          </div>
          {safetyIsSerious(type) && (
            <p className="rounded-btn border border-blocked/40 bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {t('Saving this alerts every owner straight away, in the app and on WhatsApp.')}
            </p>
          )}
          <Field label={t('What happened, in one line')} htmlFor="inc-title">
            <Input id="inc-title" name="title" required maxLength={200} placeholder={t('Fall from scaffold')} />
          </Field>
          <Field label={t('Details')} htmlFor="inc-description" optional>
            <Textarea id="inc-description" name="description" rows={3} maxLength={4000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <OptionSelect
              label={t('Who was hurt')}
              value={injured}
              onChange={setInjured}
              options={[
                { value: NOBODY, label: 'Nobody' },
                ...workers.map((worker) => ({
                  value: worker.id,
                  label: worker.trade ? `${worker.name} · ${worker.trade}` : worker.name,
                })),
                { value: SOMEONE_ELSE, label: 'Someone not on the roster' },
              ]}
            />
            {injured === SOMEONE_ELSE && (
              <Field label={t('Their name')} htmlFor="inc-other">
                <Input id="inc-other" name="other_name" maxLength={120} />
              </Field>
            )}
          </div>
          {injured !== NOBODY && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Body part')} htmlFor="inc-body" optional>
                <Input id="inc-body" name="body_part" maxLength={120} placeholder={t('Left hand')} />
              </Field>
              <Field label={t('Injury')} htmlFor="inc-nature" optional>
                <Input id="inc-nature" name="injury_nature" maxLength={200} placeholder={t('Cut, burn, fracture')} />
              </Field>
            </div>
          )}
          <Field label={t('What was done on the spot')} htmlFor="inc-action" optional>
            <Textarea id="inc-action" name="immediate_action" rows={2} maxLength={2000} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
            <Camera className="size-4" />
            {photo ? photo.name : t('Add a photo of the scene')}
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
              {t('Send report')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
