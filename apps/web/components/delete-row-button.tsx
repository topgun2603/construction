'use client';

import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ActionResult } from '@/lib/server-api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * The delete control on a table row: a quiet trash icon that turns red on hover,
 * behind a confirmation naming the record.
 *
 * Icon-only, because a row with "Delete" spelled out in a column of its own drags the
 * reader's eye down the destructive action of every row in the table. It still carries
 * a label for screen readers and a tooltip for everyone else.
 */
export function DeleteRowButton({
  what,
  title,
  body,
  confirmLabel,
  onConfirm,
  successMessage,
  disabled,
}: {
  /** The record's name, used in the tooltip and the default body text. */
  what: string;
  title?: string;
  body?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<ActionResult>;
  successMessage?: string;
  disabled?: boolean;
}) {
  return (
    <ConfirmDialog
      title={title ?? `Delete ${what}?`}
      body={
        body ?? (
          <>
            <strong className="font-semibold text-ink">{what}</strong> will be removed. Past
            records that mention it are not affected.
          </>
        )
      }
      {...(confirmLabel ? { confirmLabel } : {})}
      {...(successMessage ? { successMessage } : {})}
      onConfirm={onConfirm}
      trigger={
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-ink-faint hover:bg-blocked-bg hover:text-blocked-fg"
          title={`Delete ${what}`}
          aria-label={`Delete ${what}`}
          disabled={disabled}
        >
          <Trash2 className="size-4" />
        </Button>
      }
    />
  );
}
