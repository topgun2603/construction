'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ActionResult } from '@/lib/server-api';
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

/**
 * "Are you sure" for destructive actions, shared by every delete in the app.
 *
 * Two things it deliberately does:
 *
 * - It names the record in the body text. "Delete this?" gives the reader nothing to
 *   check against; "Delete Raju Patel?" lets them catch the wrong-row click that is
 *   the actual risk in a dense table.
 * - It keeps the dialog open when the action fails and shows the API's own message.
 *   Most of these refusals are a domain rule doing its job — a finalised wage period,
 *   an approved expense — and closing the dialog would hide the reason.
 */
export function ConfirmDialog({
  trigger,
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  successMessage,
}: {
  trigger: ReactNode;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /**
   * Runs on confirm. From a *server* component this must be a server action bound to
   * its argument — `deleteThing.bind(null, id)` — never an inline arrow: a plain
   * function cannot cross the server/client boundary and Next refuses the render.
   * Inside a client component either form is fine.
   */
  onConfirm: () => Promise<ActionResult>;
  successMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const result = await onConfirm();
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      setOpen(false);
      if (successMessage) toast.success(successMessage);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-full bg-blocked-bg text-blocked-fg">
              <AlertTriangle className="size-[18px]" />
            </span>
            <div className="flex flex-col gap-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{body}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
