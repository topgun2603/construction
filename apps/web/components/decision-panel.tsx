'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { setIndentStatus } from '@/lib/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { DashboardToday } from '@/lib/api-types';
import { cn } from '@/lib/utils';

/**
 * Approvals cleared inline from the dashboard (design note on artboard 3a): the
 * owner should never have to open a second screen to unblock a site.
 */
export function DecisionPanel({
  approvals,
  canApprove,
  className,
}: {
  approvals: DashboardToday['approvals'];
  canApprove: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const shown = approvals.slice(0, 2);

  function decide(id: string, status: 'approved' | 'rejected', label: string) {
    start(async () => {
      const result = await setIndentStatus(id, status);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not update the indent');
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Needs your decision
        </span>
        {approvals.length > 0 && (
          <span className="font-mono text-[13px] text-ink-muted">{approvals.length}</span>
        )}
      </div>

      {approvals.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-done-bg text-done-fg">
            <Check className="size-4" />
          </span>
          <p className="text-[13.5px] text-ink-muted">Nothing waiting on you.</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          {shown.map((approval) => (
            <motion.div
              key={approval.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-col gap-2.5 border-t border-line-soft pt-3 first:border-0 first:pt-0"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-medium">{approval.summary}</span>
                  <span className="truncate text-[12.5px] text-ink-muted">
                    {approval.project_name} · {approval.requested_by}
                  </span>
                </div>
                {approval.urgency === 'high' && <Badge tone="blocked">Urgent</Badge>}
              </div>

              {canApprove ? (
                <div className="flex gap-2">
                  <Button
                    variant="approve"
                    size="sm"
                    className="flex-1"
                    disabled={pending}
                    onClick={() => decide(approval.id, 'approved', 'Indent approved')}
                  >
                    <Check /> Approve
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    disabled={pending}
                    onClick={() => decide(approval.id, 'rejected', 'Indent rejected')}
                  >
                    <X /> Reject
                  </Button>
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-muted">
                  Waiting on a project manager or the owner.
                </p>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      )}

      {approvals.length > shown.length && (
        <Link
          href="/indents"
          className="mt-auto flex items-center gap-1 border-t border-line-soft pt-3 text-[13.5px] font-semibold text-accent hover:underline"
        >
          {approvals.length - shown.length} more in Approvals <ArrowRight className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}
