'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { markAllNotificationsRead } from '@/lib/actions';
import { relativeTime } from '@/lib/format';
import { useLanguage } from '@/components/language-provider';

export interface NotificationRow {
  id: string;
  type: string;
  payload: unknown;
  read_at: string | null;
  created_at: string;
}

/**
 * The bell, and what is behind it.
 *
 * The badge is a dot rather than a count. A number invites arithmetic — "why fourteen?" — and the
 * only thing that matters at this size is whether anything is waiting; the list underneath answers
 * the rest.
 *
 * Notifications are fetched by the server component that renders this, not here: the shell already
 * waits on `/me`, and a second client round trip would make the bell populate a beat after the
 * page it sits on.
 */
export function NotificationBell({ items }: { items: NotificationRow[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const unread = items.filter((item) => !item.read_at).length;

  function clear() {
    start(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : t('Notifications')}
          className="relative flex size-9 min-h-0 flex-none items-center justify-center rounded-full text-ink-soft transition hover:bg-neutral-bg"
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-blocked ring-2 ring-surface" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[330px] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2.5">
          <span className="text-[13px] font-semibold">{t('Notifications')}</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              className="flex min-h-0 items-center gap-1.5 text-[12.5px] font-medium text-accent transition hover:underline disabled:opacity-60"
            >
              <CheckCheck className="size-3.5" /> {t('Mark all read')}
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-ink-muted">
            {t('Nothing yet. Approvals and reports will show up here.')}
          </p>
        ) : (
          <ul className="max-h-[340px] overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex gap-2.5 border-b border-line-soft px-3 py-2.5 last:border-b-0 ${
                  item.read_at ? '' : 'bg-accent-soft/25'
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-1.5 size-1.5 flex-none rounded-full ${
                    item.read_at ? 'bg-transparent' : 'bg-accent'
                  }`}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium leading-snug">{describe(item)}</span>
                  <span className="text-[11.5px] text-ink-faint">
                    {relativeTime(item.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A sentence for a notification row.
 *
 * The payload is whatever the job that raised it put there, so every field is read defensively and
 * the type is the fallback — an unreadable notification should still say which kind it was rather
 * than render as an empty line.
 */
function describe(item: NotificationRow): string {
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  const name = typeof payload['project_name'] === 'string' ? payload['project_name'] : null;
  const title = typeof payload['title'] === 'string' ? payload['title'] : null;
  if (title) return name ? `${title} · ${name}` : title;

  const spoken = item.type.replace(/[._]/g, ' ');
  const sentence = spoken.charAt(0).toUpperCase() + spoken.slice(1);
  return name ? `${sentence} · ${name}` : sentence;
}
