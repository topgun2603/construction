'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SiteCheck } from '@/lib/api-types';
import { decideCheck } from '@/lib/actions';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const KIND_LABEL: Record<SiteCheck['kind'], string> = {
  double_booked: 'Paid twice for a day',
  never_off: 'No day off',
  headcount_gap: 'Roll call above report',
  duplicate_expense: 'Same bill twice',
  unusual_expense: 'Unusually large bill',
  unidentified_paid: 'Paid, no ID on file',
  fuel_outlier: 'Unusual fuel for a machine',
};

/**
 * Leak and fraud findings, each with the two decisions a person can make.
 *
 * Confirm means "yes, this is real and I am dealing with it"; dismiss means "this is fine". Both
 * take it off the list for good, and the decision is kept with the name of whoever made it. The
 * checks never change a record themselves — that is the person's call.
 */
export function CheckList({ checks, canDecide }: { checks: SiteCheck[]; canDecide: boolean }) {
  const { t } = useLanguage();
  const { money } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function decide(check: SiteCheck, decision: 'confirmed' | 'dismissed') {
    setBusyId(check.id);
    start(async () => {
      const result = await decideCheck({ id: check.id, decision });
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not save the decision'));
        return;
      }
      toast.success(decision === 'confirmed' ? t('Marked as real') : t('Dismissed'));
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {checks.map((check) => {
        const amount = typeof check.details['amount'] === 'string' ? check.details['amount'] : null;
        return (
          <li key={check.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={check.severity === 'high' ? 'blocked' : 'pending'}>
                {t(KIND_LABEL[check.kind])}
              </Badge>
              {check.project_id && check.project_name && (
                <Link
                  href={`/projects/${check.project_id}`}
                  className="text-[12.5px] font-medium text-ink-muted hover:underline"
                >
                  {check.project_name}
                </Link>
              )}
              {amount && (
                <span className="font-mono text-[12.5px] text-ink-muted">{money(amount)}</span>
              )}
            </div>
            <p className="text-[13.5px] leading-relaxed">{check.title}</p>
            {check.status !== 'open' ? (
              <span className="text-[12px] text-ink-faint">
                {check.status === 'confirmed' ? t('Confirmed') : t('Dismissed')}
                {check.note ? ` — ${check.note}` : ''}
              </span>
            ) : (
              canDecide && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending && busyId === check.id}
                    onClick={() => decide(check, 'confirmed')}
                  >
                    <Check className="size-3.5" /> {t('It’s real')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending && busyId === check.id}
                    onClick={() => decide(check, 'dismissed')}
                  >
                    <X className="size-3.5" /> {t('Dismiss')}
                  </Button>
                </div>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
