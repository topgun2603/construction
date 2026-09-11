'use client';

import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * The date range for one worker's account.
 *
 * Defaults to no range at all, which is the whole history — for a worker the question
 * is usually "what do we owe him", and that is only correct over every entry. Narrowing
 * is opt-in, and clearing returns to the full account.
 */
export function LedgerRange({
  workerId,
  from,
  to,
}: {
  workerId: string;
  from: string | null;
  to: string | null;
}) {
  const router = useRouter();

  function navigate(next: { from?: string | null; to?: string | null }) {
    const nextFrom = next.from === undefined ? from : next.from;
    const nextTo = next.to === undefined ? to : next.to;
    const query = new URLSearchParams();
    if (nextFrom) query.set('from', nextFrom);
    if (nextTo) query.set('to', nextTo);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    router.push(`/labour/workers/${workerId}${suffix}`);
  }

  return (
    <div className="flex items-end gap-2">
      <Input
        type="date"
        value={from ?? ''}
        onChange={(event) => navigate({ from: event.target.value || null })}
        className="w-[160px]"
        aria-label="From date"
      />
      <span className="pb-2.5 text-ink-muted">→</span>
      <Input
        type="date"
        value={to ?? ''}
        onChange={(event) => navigate({ to: event.target.value || null })}
        className="w-[160px]"
        aria-label="To date"
      />
      {(from || to) && (
        <Button variant="ghost" size="sm" onClick={() => navigate({ from: null, to: null })}>
          Full history
        </Button>
      )}
    </div>
  );
}
