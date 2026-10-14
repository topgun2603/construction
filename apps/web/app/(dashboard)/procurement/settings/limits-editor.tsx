'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveProcurementSettings } from '@/lib/procurement-actions';
import type { Role, TeamMember } from '@/lib/api-types';
import type { ProcurementSettings } from '@/lib/procurement-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import { percent, percentToBp } from '../status';

interface Row {
  key: number;
  /** `role:<id>` or `user:<id>`. */
  subject: string;
  /** Major units; empty is unlimited. */
  amount: string;
}

/**
 * The owner's editor for approval limits and the match tolerance. Saved as a whole list: what is
 * on screen is what is stored.
 */
export function LimitsEditor({
  settings,
  roles,
  team,
}: {
  settings: ProcurementSettings;
  roles: Role[];
  team: TeamMember[];
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [tolerance, setTolerance] = useState(String(settings.match_tolerance_bp / 100));
  const [rows, setRows] = useState<Row[]>(() =>
    settings.limits.map((limit, index) => ({
      key: index + 1,
      subject: limit.role_id ? `role:${limit.role_id}` : `user:${limit.user_id}`,
      amount: limit.max_amount === null ? '' : minorToAmountInput(limit.max_amount, format.currencyDigits),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Owners are always unlimited, so neither the owner role nor owners are offered.
  const roleOptions = roles.filter((role) => role.base_role !== 'owner');
  const people = team.filter((member) => member.role !== 'owner' && member.status !== 'disabled');

  function save() {
    setError(null);
    const bp = percentToBp(tolerance);
    if (Number.isNaN(bp) || bp > 2000) return setError(t('The tolerance is a percentage up to 20'));
    const limits: Array<{ role_id?: string; user_id?: string; max_amount: string | null }> = [];
    for (const row of rows) {
      if (!row.subject) continue;
      const [kind, id] = row.subject.split(':') as ['role' | 'user', string];
      let maxAmount: string | null = null;
      if (row.amount.trim()) {
        try {
          maxAmount = amountToMinorString(row.amount, format.currencyDigits, format.currencySymbol);
        } catch {
          return setError(t('A limit is not an amount'));
        }
      }
      limits.push(kind === 'role' ? { role_id: id, max_amount: maxAmount } : { user_id: id, max_amount: maxAmount });
    }
    start(async () => {
      const result = await saveProcurementSettings({ match_tolerance_bp: bp, limits });
      if (!result.ok) {
        setError(result.error ?? t('Could not save'));
        return;
      }
      toast.success(t('Approval limits saved'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center gap-2">
            <Select
              value={row.subject}
              onValueChange={(value) =>
                setRows((current) => current.map((item) => (item.key === row.key ? { ...item, subject: value } : item)))
              }
            >
              <SelectTrigger aria-label={t('Role or person')} className="w-[260px]">
                <SelectValue placeholder={t('Role or person')} />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role.id} value={`role:${role.id}`}>
                    {t('Role')}: {role.name}
                  </SelectItem>
                ))}
                {people.map((member) => (
                  <SelectItem key={member.id} value={`user:${member.id}`}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t('Up to')}
              inputMode="decimal"
              placeholder={t('No limit')}
              className="w-[180px] text-end font-mono"
              value={row.amount}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item) => (item.key === row.key ? { ...item, amount: event.target.value } : item)),
                )
              }
            />
            <span className="text-[12px] text-ink-muted">{format.currencySymbol}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('Remove')}
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: Math.max(0, ...current.map((item) => item.key)) + 1, subject: '', amount: '' },
            ])
          }
        >
          <Plus className="size-4" /> {t('Add a limit')}
        </Button>
        <p className="text-[12.5px] text-ink-muted">
          {t('Leave the amount empty for no limit. A person’s own limit replaces their role’s.')}
        </p>
      </div>

      <Field
        label={t('Invoice match tolerance (%)')}
        hint={`${t('Differences within this are let through. Now')} ${percent(settings.match_tolerance_bp)}.`}
        className="max-w-[260px]"
      >
        <Input inputMode="decimal" value={tolerance} onChange={(event) => setTolerance(event.target.value)} />
      </Field>

      {error && (
        <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
          {error}
        </p>
      )}
      <Button className="self-start" onClick={save} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t('Save')}
      </Button>
    </div>
  );
}
