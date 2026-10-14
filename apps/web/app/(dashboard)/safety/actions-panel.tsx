'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { raiseSafetyAction, safetyTeam, updateSafetyAction } from '@/lib/safety-actions';
import type { SafetyAction } from '@/lib/safety-types';
import { ACTION_STATUS } from './labels';
import { OptionSelect } from './site-picker';

const UNASSIGNED = '__none__';

/**
 * Corrective and preventive actions on an incident or an observation: who owns each, by when, and
 * whether it is done. A safety manager raises and edits them; the person one is assigned to marks it
 * done.
 */
export function ActionsPanel({
  parent,
  actions,
  canManage,
  meId,
  locked,
}: {
  parent: { incidentId: string } | { observationId: string };
  actions: SafetyAction[];
  canManage: boolean;
  meId: string;
  /** Closed records take no new actions. */
  locked?: boolean;
}) {
  const { t } = useLanguage();
  const { shortDate, todayIso } = useFormat();
  const router = useRouter();
  const [team, setTeam] = useState<Array<{ id: string; name: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [assignee, setAssignee] = useState(UNASSIGNED);
  const [kind, setKind] = useState<'corrective' | 'preventive'>('corrective');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!adding || team.length > 0) return;
    void safetyTeam().then((result) => setTeam(result.ok ? (result.data ?? []) : []));
  }, [adding, team.length]);

  function raise(formData: FormData) {
    const description = String(formData.get('description') ?? '').trim();
    const due = String(formData.get('due') ?? '').trim();
    if (!description) return;
    start(async () => {
      const result = await raiseSafetyAction(parent, {
        kind,
        description,
        ...(assignee !== UNASSIGNED ? { assignee_id: assignee } : {}),
        ...(due ? { due_on: due } : {}),
      });
      if (!result.ok) return void toast.error(result.error ?? t('Could not raise the action'));
      setAdding(false);
      setAssignee(UNASSIGNED);
      router.refresh();
    });
  }

  function markDone(action: SafetyAction) {
    start(async () => {
      const result = await updateSafetyAction(action.id, { status: 'done' });
      if (!result.ok) return void toast.error(result.error ?? t('Could not update the action'));
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{t('Corrective and preventive actions')}</h3>
        {canManage && !locked && !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> {t('Raise action')}
          </Button>
        )}
      </div>
      {actions.length === 0 && !adding && <p className="text-[13px] text-ink-muted">{t('No actions raised.')}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {actions.map((action) => {
          const status = ACTION_STATUS[action.status];
          const mine = action.assignee?.id === meId;
          return (
            <li key={action.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13.5px]">{action.description}</span>
                <span className="text-[12px] text-ink-muted">
                  {t(action.kind === 'corrective' ? 'Corrective' : 'Preventive')} ·{' '}
                  {action.assignee?.name ?? t('Unassigned')}
                  {action.due_on && ` · ${t('due')} ${shortDate(action.due_on)}`}
                  {action.note && ` · ${action.note}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {action.overdue && <Badge tone="blocked">{t('Overdue')}</Badge>}
                <Badge tone={status.tone}>{t(status.label)}</Badge>
                {action.status === 'open' && (canManage || mine) && (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => markDone(action)}>
                    <Check className="size-4" /> {t('Done')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {adding && (
        <form action={raise} className="flex flex-col gap-3 rounded-btn border border-line p-3">
          <Input name="description" required maxLength={1000} placeholder={t('What will be done')} />
          <div className="grid gap-3 sm:grid-cols-3">
            <OptionSelect
              label={t('Kind')}
              value={kind}
              onChange={(value) => setKind(value as 'corrective' | 'preventive')}
              options={[
                { value: 'corrective', label: 'Corrective' },
                { value: 'preventive', label: 'Preventive' },
              ]}
            />
            <OptionSelect
              label={t('Assigned to')}
              value={assignee}
              onChange={setAssignee}
              options={[{ value: UNASSIGNED, label: 'Unassigned' }, ...team.map((m) => ({ value: m.id, label: m.name }))]}
            />
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              {t('Due')}
              <Input name="due" type="date" min={todayIso()} dir="ltr" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Raise action')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
