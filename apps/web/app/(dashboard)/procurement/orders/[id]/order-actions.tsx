'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, Loader2, Lock, Send, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { purchaseOrderAction } from '@/lib/procurement-actions';
import type { PurchaseOrder } from '@/lib/procurement-types';
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
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useLanguage } from '@/components/language-provider';

type Action = 'submit' | 'approve' | 'reject' | 'send' | 'cancel' | 'close';

/**
 * The buttons an order offers at its current status, to this person. The API is the judge of what
 * is legal; this only avoids offering what it would refuse.
 */
export function OrderActions({
  order,
  canManage,
  canApprove,
}: {
  order: PurchaseOrder;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Action | null>(null);

  function run(action: Action, note?: string, done?: () => void) {
    setBusy(action);
    start(async () => {
      const result = await purchaseOrderAction(order.id, action, note);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error ?? t('That did not work'));
        return;
      }
      toast.success(
        action === 'submit' && result.data?.status === 'approved'
          ? t('Approved — it was within your limit')
          : t('Done'),
      );
      done?.();
      router.refresh();
    });
  }

  const spin = (action: Action) => busy === action && pending;
  const status = order.status;
  const received = order.lines.some((line) => Number(line.received_quantity) > 0);

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {canManage && status === 'draft' && (
        <Button size="sm" onClick={() => run('submit')} disabled={pending}>
          {spin('submit') ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t('Ask for approval')}
        </Button>
      )}
      {canApprove && status === 'pending_approval' && order.approval?.can_approve && (
        <NoteDialog
          title={t('Approve this order')}
          description={t('Your approval is recorded with your name and the time.')}
          label={t('Note')}
          optional
          confirm={t('Approve')}
          variant="approve"
          icon={<Check className="size-4" />}
          pending={spin('approve')}
          onConfirm={(note, done) => run('approve', note || undefined, done)}
        />
      )}
      {canApprove && status === 'pending_approval' && (
        <NoteDialog
          title={t('Send back to draft')}
          description={t('Say what needs changing. Whoever raised it is told.')}
          label={t('Reason')}
          confirm={t('Send back')}
          variant="secondary"
          icon={<Undo2 className="size-4" />}
          pending={spin('reject')}
          onConfirm={(note, done) => run('reject', note, done)}
        />
      )}
      {canManage && status === 'approved' && (
        <Button size="sm" onClick={() => run('send')} disabled={pending}>
          {spin('send') ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t('Mark as sent')}
        </Button>
      )}
      {canManage && ['sent', 'partially_received', 'received'].includes(status) && (
        <Button size="sm" variant="secondary" onClick={() => run('close')} disabled={pending}>
          {spin('close') ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
          {t('Close order')}
        </Button>
      )}
      {canManage && ['draft', 'pending_approval', 'approved', 'sent'].includes(status) && !received && (
        <Button size="sm" variant="destructive" onClick={() => run('cancel')} disabled={pending}>
          {spin('cancel') ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
          {t('Cancel order')}
        </Button>
      )}
    </div>
  );
}

function NoteDialog({
  title,
  description,
  label,
  optional = false,
  confirm,
  variant,
  icon,
  pending,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  optional?: boolean;
  confirm: string;
  variant: 'approve' | 'secondary';
  icon: React.ReactNode;
  pending: boolean;
  onConfirm: (note: string, done: () => void) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          {icon}
          {confirm}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Field label={label} optional={optional}>
          <Textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            variant={variant === 'approve' ? 'approve' : 'primary'}
            disabled={pending || (!optional && note.trim() === '')}
            onClick={() => onConfirm(note.trim(), () => setOpen(false))}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
