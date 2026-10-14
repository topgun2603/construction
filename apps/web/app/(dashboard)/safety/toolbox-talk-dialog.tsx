'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { SAFETY_TOOLBOX_TOPICS } from '@sitebook/shared';
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
import { recordToolboxTalk, safetyRoll } from '@/lib/safety-actions';
import type { SafetyRoll } from '@/lib/safety-types';
import { uploadSafetyPhoto } from './photo-upload';
import { OptionSelect, SitePicker } from './site-picker';

const OWN_TOPIC = '__own__';

/**
 * Record the morning toolbox talk. The attendees are that day's roll call for the site — everybody
 * present is ticked, so the usual case is one tap — and whoever did not sign yet can sign later.
 */
export function ToolboxTalkDialog({
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
  const [date, setDate] = useState(format.todayIso());
  const [topic, setTopic] = useState(SAFETY_TOOLBOX_TOPICS[0]!.key);
  const [roll, setRoll] = useState<SafetyRoll['items']>([]);
  const [attending, setAttending] = useState<Map<string, boolean>>(new Map());
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !siteId || !date) return;
    let live = true;
    void safetyRoll(siteId, date).then((result) => {
      if (!live) return;
      const items = result.ok ? (result.data?.items ?? []) : [];
      setRoll(items);
      // Everybody on the roll is ticked and signed; the presenter unticks who was not there.
      setAttending(new Map(items.map((row) => [row.worker_id, true])));
    });
    return () => {
      live = false;
    };
  }, [open, siteId, date]);

  function toggle(workerId: string, field: 'attended' | 'signed') {
    setAttending((current) => {
      const next = new Map(current);
      if (field === 'attended') {
        if (next.has(workerId)) next.delete(workerId);
        else next.set(workerId, true);
      } else if (next.has(workerId)) {
        next.set(workerId, !next.get(workerId));
      }
      return next;
    });
  }

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId) return setError(t('Choose the site'));
    const ownTopic = read('own_topic');
    if (topic === OWN_TOPIC && !ownTopic) return setError(t('Type the topic'));
    start(async () => {
      let photoKey: string | undefined;
      if (photo) {
        const uploaded = await uploadSafetyPhoto(photo, siteId);
        if (!uploaded.ok) return setError(t(uploaded.error));
        photoKey = uploaded.key;
      }
      const minutes = Number(read('minutes') || '15');
      const result = await recordToolboxTalk({
        project_id: siteId,
        talk_date: date,
        ...(topic === OWN_TOPIC ? { topic: ownTopic } : { topic_key: topic }),
        ...(read('notes') ? { notes: read('notes') } : {}),
        duration_minutes: Number.isInteger(minutes) && minutes > 0 ? minutes : 15,
        attendees: [...attending].map(([worker_id, signed]) => ({ worker_id, signed })),
        ...(photoKey ? { photo_keys: [photoKey] } : {}),
      });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not save the talk'));
      toast.success(`${t('Toolbox talk recorded')} · ${result.data.attendees.length} ${t('attended')}`);
      setOpen(false);
      setPhoto(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Megaphone className="size-4" />
          {t('Toolbox talk')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Record a toolbox talk')}</DialogTitle>
          <DialogDescription>{t('Attendees come from that day’s roll call for the site.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
            <Field label={t('Date')} htmlFor="tbt-date">
              <Input
                id="tbt-date"
                type="date"
                value={date}
                max={format.todayIso()}
                onChange={(event) => setDate(event.target.value)}
                dir="ltr"
              />
            </Field>
          </div>
          <OptionSelect
            label={t('Topic')}
            value={topic}
            onChange={setTopic}
            options={[
              ...SAFETY_TOOLBOX_TOPICS.map((entry) => ({ value: entry.key, label: entry.title })),
              { value: OWN_TOPIC, label: 'Another topic…' },
            ]}
          />
          {topic === OWN_TOPIC && (
            <Field label={t('Topic')} htmlFor="tbt-own">
              <Input id="tbt-own" name="own_topic" maxLength={200} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label={t('Points covered')} htmlFor="tbt-notes" optional>
              <Textarea id="tbt-notes" name="notes" rows={2} maxLength={2000} />
            </Field>
            <Field label={t('Minutes')} htmlFor="tbt-minutes">
              <Input id="tbt-minutes" name="minutes" type="number" min={1} max={240} defaultValue={15} dir="ltr" />
            </Field>
          </div>
          <Field
            label={`${t('Attendees')} (${attending.size}/${roll.length})`}
            hint={roll.length === 0 ? t('Nobody is on the roll for this day yet. Take the roll call first.') : undefined}
          >
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-btn border border-line p-2">
              {roll.map((row) => (
                <div key={row.worker_id} className="flex items-center justify-between gap-2 text-[13px]">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={attending.has(row.worker_id)}
                      onChange={() => toggle(row.worker_id, 'attended')}
                    />
                    {row.name}
                    {row.trade && <span className="text-ink-muted">· {row.trade}</span>}
                  </label>
                  {attending.has(row.worker_id) && (
                    <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                      <input
                        type="checkbox"
                        checked={attending.get(row.worker_id) === true}
                        onChange={() => toggle(row.worker_id, 'signed')}
                      />
                      {t('Signed')}
                    </label>
                  )}
                </div>
              ))}
            </div>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
            <Camera className="size-4" />
            {photo ? photo.name : t('Add a photo of the talk or the signed sheet')}
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
              {t('Save talk')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
