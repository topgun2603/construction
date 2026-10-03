'use client';

import { useState, useTransition } from 'react';
import { Mail, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { linkOperatorEmail } from '@/lib/platform-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';

/**
 * The Google address an operator may also sign in with.
 *
 * An alternative key to the same person, never a second identity: the API resolves the address to
 * this operator's number before issuing a session, so a Google sign-in and an SMS sign-in by the
 * same operator are one entry in the audit trail. That is why this control lives on an operator
 * row rather than being a separate list of "Google operators" — there is no such thing.
 *
 * Root operators can have one too, which is why this is a component and not part of the granted
 * list: both tables draw it.
 *
 * Shown read-only to an operator who is not root. Linking an address is handing somebody a way in,
 * which is the same act as granting access and belongs to the same small circle.
 */
export function EmailLink({
  phone,
  email,
  canManage,
}: {
  phone: string;
  email: string | null;
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(email ?? '');
  const [pending, start] = useTransition();

  function save(next: string | null) {
    start(async () => {
      const result = await linkOperatorEmail(phone, next);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the address');
        return;
      }
      toast.success(next ? 'Address linked' : 'Address cleared');
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <form
        className="flex items-center gap-2"
        action={() => save(value.trim() === '' ? null : value.trim())}
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          type="email"
          autoFocus
          placeholder="name@company.com"
          className="h-8 w-[230px] text-[13px]"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {t('Save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setValue(email ?? '');
            setEditing(false);
          }}
        >
          {t('Cancel')}
        </Button>
      </form>
    );
  }

  if (!email) {
    if (!canManage) {
      return <span className="text-[12.5px] text-ink-faint">{t('No Google address')}</span>;
    }
    return (
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
        <Mail className="size-3.5" />
        {t('Link Google address')}
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <Mail className="size-3.5 flex-none text-ink-faint" aria-hidden />
      <span className="text-[12.5px] text-ink-soft">{email}</span>
      {canManage && (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-ink-faint"
            onClick={() => setEditing(true)}
            disabled={pending}
            aria-label={`Change the Google address for ${phone}`}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-ink-faint hover:text-blocked-fg"
            onClick={() => save(null)}
            disabled={pending}
            aria-label={`Unlink the Google address for ${phone}`}
            title={t('Unlink')}
          >
            <X className="size-3.5" />
          </Button>
        </>
      )}
    </span>
  );
}
