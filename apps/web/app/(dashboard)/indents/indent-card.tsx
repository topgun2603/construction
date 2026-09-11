'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { motion } from 'framer-motion';
import { Check, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { deleteIndent, setIndentStatus } from '@/lib/actions';
import { DeleteRowButton } from '@/components/delete-row-button';
import { ReceiveDialog } from './receive-dialog';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { shortDate, titleCase } from '@/lib/format';
import type { Indent } from '@/lib/api-types';

const STATUS_TONE: Record<Indent['status'], Tone> = {
  requested: 'pending',
  approved: 'accent',
  ordered: 'accent',
  received: 'done',
  rejected: 'blocked',
};

export function IndentCard({ indent, canApprove }: { indent: Indent; canApprove: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function move(status: 'approved' | 'rejected' | 'ordered' | 'received', label: string) {
    start(async () => {
      const result = await setIndentStatus(indent.id, status);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not update the indent');
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  return (
    <motion.div layout>
      <Card className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[16px] font-semibold">{indent.project_name}</span>
            <span className="text-[12.5px] text-ink-muted">
              {indent.requested_by.name} · {shortDate(indent.created_at.slice(0, 10))}
              {indent.required_by && ` · needed by ${shortDate(indent.required_by)}`}
            </span>
          </div>
          <div className="flex flex-none gap-2">
            {indent.urgency === 'high' && <Badge tone="blocked">Urgent</Badge>}
            <Badge tone={STATUS_TONE[indent.status]}>{titleCase(indent.status)}</Badge>
          </div>
        </div>

        <ul className="flex flex-col gap-1.5 rounded-btn bg-raised p-3">
          {indent.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="truncate">{item.material_name}</span>
              <span className="flex-none font-mono">
                {item.quantity} {item.unit}
                {Number(item.received_quantity) > 0 && (
                  <span className="ml-2 text-done-fg">
                    ({item.received_quantity} in)
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {indent.notes && (
          <p className="text-[13px] leading-relaxed text-ink-muted">{indent.notes}</p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 border-t border-line-soft pt-3">
          {indent.status === 'requested' && canApprove && (
            <>
              <Button
                variant="approve"
                size="sm"
                className="flex-1"
                disabled={pending}
                onClick={() => move('approved', 'Indent approved')}
              >
                <Check /> Approve
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                disabled={pending}
                onClick={() => move('rejected', 'Indent rejected')}
              >
                <X /> Reject
              </Button>
            </>
          )}

          {indent.status === 'requested' && !canApprove && (
            <p className="text-[13px] text-ink-muted">
              Waiting on a project manager or the owner.
            </p>
          )}

          {indent.status === 'approved' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => move('ordered', 'Marked as ordered')}
              >
                <Truck /> Mark ordered
              </Button>
              <ReceiveDialog indent={indent} />
            </>
          )}

          {indent.status === 'ordered' && (
            <ReceiveDialog indent={indent} />
          )}

          {indent.status === 'received' && <ReceiveDialog indent={indent} amend />}

          {(indent.status === 'received' || indent.status === 'rejected') && indent.approved_by && (
            <p className="text-[13px] text-ink-muted">
              {titleCase(indent.status)} by {indent.approved_by.name}
            </p>
          )}

          {/* Withdrawing is only for a request nobody has answered yet; once it is
              approved the API refuses, and rejection is the right move instead. */}
          {indent.status === 'requested' && (
            <DeleteRowButton
              what="this indent"
              title="Withdraw this indent?"
              body={
                <>
                  The request for {indent.project_name} is removed before anyone acts on it.
                  Nothing is ordered and nobody is notified.
                </>
              }
              confirmLabel="Withdraw indent"
              successMessage="Indent withdrawn"
              onConfirm={() => deleteIndent(indent.id)}
            />
          )}
        </div>
      </Card>
    </motion.div>
  );
}
