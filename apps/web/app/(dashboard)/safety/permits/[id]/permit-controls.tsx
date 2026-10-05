'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/components/language-provider';
import { safetyPermitStep, updateSafetyPermit } from '@/lib/safety-actions';
import type { SafetyPermitDetail } from '@/lib/safety-types';

/**
 * The checklist, ticked at the work point. Editable while the permit waits for signatures, by the
 * person who asked for it or a safety manager; saving takes off any signature already given.
 */
export function PermitChecklist({ permit, canEdit }: { permit: SafetyPermitDetail; canEdit: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState(permit.checklist);
  const [pending, start] = useTransition();
  const dirty = items.some((item, index) => item.checked !== permit.checklist[index]?.checked);
  const signed = Boolean(permit.issuer || permit.area_authority);

  function save() {
    start(async () => {
      const result = await updateSafetyPermit(permit.id, { checklist: items });
      if (!result.ok) return void toast.error(result.error ?? t('Could not save the checklist'));
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-[14px] font-semibold">{t('Checklist')}</h3>
      <ul className="flex flex-col gap-2 text-[13.5px]">
        {items.map((item, index) => (
          <li key={item.item}>
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={item.checked}
                disabled={!canEdit || pending}
                onChange={() =>
                  setItems((current) =>
                    current.map((entry, at) => (at === index ? { ...entry, checked: !entry.checked } : entry)),
                  )
                }
              />
              {t(item.item)}
            </label>
          </li>
        ))}
      </ul>
      {canEdit && dirty && (
        <div className="flex items-center justify-end gap-3">
          {signed && <span className="text-[12.5px] text-pending-fg">{t('Saving takes off the signatures already given.')}</span>}
          <Button size="sm" onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Save checklist')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Signing, suspending, resuming and closing: what each person may do with the permit now. */
export function PermitSteps({
  permit,
  canManage,
  meId,
}: {
  permit: SafetyPermitDetail;
  canManage: boolean;
  meId: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const requester = permit.requested_by?.id === meId;

  function step(name: Parameters<typeof safetyPermitStep>[1]) {
    let note: string | undefined;
    if (name === 'suspend') {
      note = window.prompt(t('Why is work stopping?')) ?? undefined;
      if (!note) return;
    }
    if (name === 'close') note = window.prompt(t('Closing note (optional)')) ?? undefined;
    start(async () => {
      const result = await safetyPermitStep(permit.id, name, note || undefined);
      if (!result.ok) return void toast.error(result.error ?? t('Could not update the permit'));
      router.refresh();
    });
  }

  const buttons: Array<{ key: Parameters<typeof safetyPermitStep>[1]; label: string; show: boolean }> = [
    {
      key: 'approve-issuer',
      label: 'Sign as issuer',
      show: canManage && permit.status === 'requested' && !permit.issuer && permit.area_authority?.id !== meId,
    },
    {
      key: 'approve-area',
      label: 'Sign as area authority',
      show: canManage && permit.status === 'requested' && !permit.area_authority && permit.issuer?.id !== meId,
    },
    { key: 'suspend', label: 'Suspend', show: canManage && permit.status === 'active' },
    { key: 'resume', label: 'Resume', show: canManage && permit.status === 'suspended' && !permit.expired },
    { key: 'close', label: permit.status === 'requested' ? 'Withdraw' : 'Close permit', show: (canManage || requester) && permit.status !== 'closed' },
  ];

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {buttons
        .filter((button) => button.show)
        .map((button) => (
          <Button
            key={button.key}
            size="sm"
            variant={button.key.startsWith('approve') ? 'approve' : button.key === 'suspend' ? 'destructive' : 'secondary'}
            disabled={pending || (button.key.startsWith('approve') && !permit.checklist_complete)}
            title={button.key.startsWith('approve') && !permit.checklist_complete ? t('Tick every check first') : undefined}
            onClick={() => step(button.key)}
          >
            {t(button.label)}
          </Button>
        ))}
    </div>
  );
}
