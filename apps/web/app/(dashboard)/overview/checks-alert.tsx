import Link from 'next/link';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import type { SiteCheck } from '@/lib/api-types';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { CheckList } from '@/components/check-list';
import { getT } from '@/lib/i18n-server';

/**
 * Leak and fraud findings waiting for a decision.
 *
 * Shown only when there is something to decide, and decided right here: the overview is the
 * inbox, and sending an owner to another screen to tap "dismiss" is how findings go unread.
 */
export async function ChecksAlert({
  checks,
  canDecide,
}: {
  checks: SiteCheck[];
  canDecide: boolean;
}) {
  const t = await getT();
  if (checks.length === 0) return null;

  return (
    <FadeIn delay={0.05}>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <ShieldAlert className="size-3.5 text-blocked-fg" />
            {t('Worth a look')} · {checks.length}
          </span>
          <Link
            href="/checks"
            className="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
          >
            {t('All checks')} <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <CheckList checks={checks.slice(0, 3)} canDecide={canDecide} />
      </Card>
    </FadeIn>
  );
}
