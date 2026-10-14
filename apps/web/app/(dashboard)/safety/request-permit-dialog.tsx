'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileKey2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SAFETY_PERMIT_CHECKLISTS,
  SAFETY_PERMIT_MAX_HOURS,
  SAFETY_PERMIT_TYPES,
  SAFETY_PERMIT_TYPE_LABELS,
  type SafetyPermitType,
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
import { requestSafetyPermit, safetySiteWorkers } from '@/lib/safety-actions';
import { localNow } from './labels';
import { OptionSelect, SitePicker } from './site-picker';

/**
 * Ask for a permit to work: what, where, when and who. The type's checklist comes with it, to be
 * ticked at the work point before the issuer and the area authority sign.
 */
export function RequestPermitDialog({
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
  const [type, setType] = useState<SafetyPermitType>('hot_work');
  const [workers, setWorkers] = useState<Array<{ id: string; name: string; trade: string | null }>>([]);
  const [crew, setCrew] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tz = format.settings.timezone;

  useEffect(() => {
    if (!open || !siteId) return;
    let live = true;
    setCrew(new Set());
    void safetySiteWorkers(siteId).then((result) => {
      if (live) setWorkers(result.ok ? (result.data ?? []) : []);
    });
    return () => {
      live = false;
    };
  }, [open, siteId]);

  function toggle(workerId: string) {
    setCrew((current) => {
      const next = new Set(current);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  }

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId) return setError(t('Choose the site'));
    start(async () => {
      const result = await requestSafetyPermit({
        project_id: siteId,
        type,
        description: read('description'),
        area: read('area'),
        valid_from: read('valid_from'),
        valid_to: read('valid_to'),
        crew: [...crew],
        ...(read('precautions') ? { precautions: read('precautions') } : {}),
      });
      if (!result.ok || !result.data) return setError(result.error ?? t('Could not request the permit'));
      toast.success(`${result.data.number} ${t('requested')}`);
      setOpen(false);
      router.push(`/safety/permits/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <FileKey2 className="size-4" />
          {t('Request permit')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Request a permit to work')}</DialogTitle>
          <DialogDescription>
            {t('Work stops when the permit’s time runs out. Longer jobs are re-permitted shift by shift.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!fixedSiteId && <SitePicker sites={sites} value={siteId} onChange={setSiteId} />}
            <OptionSelect
              label={t('Type of work')}
              value={type}
              onChange={(value) => setType(value as SafetyPermitType)}
              options={SAFETY_PERMIT_TYPES.map((value) => ({ value, label: SAFETY_PERMIT_TYPE_LABELS[value] }))}
            />
          </div>
          <Field label={t('The work')} htmlFor="ptw-description">
            <Input id="ptw-description" name="description" required maxLength={1000} placeholder={t('Welding handrail brackets')} />
          </Field>
          <Field label={t('Area')} htmlFor="ptw-area">
            <Input id="ptw-area" name="area" required maxLength={200} placeholder={t('Level 4 stair core')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Valid from')} htmlFor="ptw-from">
              <Input id="ptw-from" name="valid_from" type="datetime-local" required defaultValue={localNow(tz)} dir="ltr" />
            </Field>
            <Field
              label={t('Valid to')}
              htmlFor="ptw-to"
              hint={`${t('At most')} ${SAFETY_PERMIT_MAX_HOURS} ${t('hours')}`}
            >
              <Input id="ptw-to" name="valid_to" type="datetime-local" required defaultValue={localNow(tz, 8 * 60)} dir="ltr" />
            </Field>
          </div>
          <Field label={t('Crew')} optional hint={workers.length === 0 ? t('Nobody is assigned to this site yet') : undefined}>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-btn border border-line p-2">
              {workers.map((worker) => (
                <label key={worker.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={crew.has(worker.id)} onChange={() => toggle(worker.id)} />
                  {worker.name}
                  {worker.trade && <span className="text-ink-muted">· {worker.trade}</span>}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('Precautions and readings')} htmlFor="ptw-precautions" optional>
            <Textarea id="ptw-precautions" name="precautions" rows={2} maxLength={2000} />
          </Field>
          <div className="flex flex-col gap-1 rounded-btn bg-raised px-3 py-2 text-[12.5px] text-ink-muted">
            <span className="font-semibold text-ink">{t('Checks to tick before signing')}</span>
            {SAFETY_PERMIT_CHECKLISTS[type].map((item) => (
              <span key={item}>· {t(item)}</span>
            ))}
          </div>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Request permit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
