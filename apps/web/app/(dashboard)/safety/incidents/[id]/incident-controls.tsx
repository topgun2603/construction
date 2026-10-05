'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SafetyIncidentStatus } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useLanguage } from '@/components/language-provider';
import { setSafetyIncidentStatus, updateSafetyIncident } from '@/lib/safety-actions';
import type { SafetyIncidentDetail } from '@/lib/safety-types';

const STEP_LABEL: Record<SafetyIncidentStatus, string> = {
  reported: 'Mark reported',
  investigating: 'Start investigation',
  actions_open: 'Actions under way',
  closed: 'Close incident',
};

/** The status buttons a safety manager sees, in the order the incident can move. */
export function IncidentStatusButtons({ incident }: { incident: SafetyIncidentDetail }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();

  function move(status: SafetyIncidentStatus) {
    const reopening = incident.status === 'closed';
    const note = status === 'closed' ? window.prompt(t('Closing note (optional)')) ?? undefined : undefined;
    start(async () => {
      const result = await setSafetyIncidentStatus(incident.id, status, note || undefined);
      if (!result.ok) return void toast.error(result.error ?? t('Could not change the status'));
      toast.success(reopening ? t('Reopened') : t('Updated'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {incident.next_statuses.map((status) => (
        <Button
          key={status}
          size="sm"
          variant={status === 'closed' ? 'approve' : 'secondary'}
          disabled={pending}
          onClick={() => move(status)}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {incident.status === 'closed' ? t('Reopen') : t(STEP_LABEL[status])}
        </Button>
      ))}
    </div>
  );
}

/**
 * The investigation: five whys and the root cause they lead to, and the days lost. Editable by a
 * safety manager until the incident is closed.
 */
export function InvestigationForm({ incident, canEdit }: { incident: SafetyIncidentDetail; canEdit: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const whys = [0, 1, 2, 3, 4].map((index) => incident.root_cause_whys[index] ?? '');

  function save(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    const lost = read('lost_days');
    start(async () => {
      const result = await updateSafetyIncident(incident.id, {
        root_cause_whys: whys.map((_, index) => read(`why${index}`)),
        root_cause: read('root_cause') || null,
        ...(lost === '' ? { lost_days: null } : { lost_days: Number(lost) }),
      });
      if (!result.ok) return setError(result.error ?? t('Could not save the investigation'));
      toast.success(t('Investigation saved'));
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-[14px] font-semibold">{t('Investigation')}</h3>
      <form action={save} className="flex flex-col gap-3">
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-2">
          <legend className="mb-1 text-[12.5px] text-ink-muted">{t('Ask “why?” until you reach something that can be fixed.')}</legend>
          {whys.map((why, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[12.5px] text-ink-muted">
                {t('Why')} {index + 1}
              </span>
              <Input name={`why${index}`} defaultValue={why} maxLength={500} />
            </div>
          ))}
          <Field label={t('Root cause')} htmlFor="root-cause">
            <Textarea id="root-cause" name="root_cause" rows={2} maxLength={2000} defaultValue={incident.root_cause ?? ''} />
          </Field>
          <Field label={t('Working days lost')} htmlFor="lost-days" optional>
            <Input
              id="lost-days"
              name="lost_days"
              type="number"
              min={0}
              defaultValue={incident.lost_days ?? ''}
              className="max-w-32"
              dir="ltr"
            />
          </Field>
        </fieldset>
        {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save investigation')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
