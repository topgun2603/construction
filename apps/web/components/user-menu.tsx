'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { LogOut, Settings, UserRound } from 'lucide-react';
import { signOut } from '@/lib/actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initials } from '@/components/ui/avatar';
import { titleCase } from '@/lib/format';

export function UserMenu({
  name,
  phone,
  role,
  isOwner,
}: {
  name: string;
  phone: string;
  role: string;
  isOwner: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className="flex size-9 min-h-0 flex-none items-center justify-center rounded-full bg-neutral-bg text-[13px] font-semibold text-ink-soft transition hover:bg-line focus-visible:outline-2"
        >
          {initials(name)}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[220px]">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex size-9 flex-none items-center justify-center rounded-full bg-neutral-bg text-[13px] font-semibold text-ink-soft">
            {initials(name)}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-medium">{name}</span>
            <span className="truncate font-mono text-[12px] text-ink-muted">+{phone}</span>
          </div>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{titleCase(role)}</DropdownMenuLabel>

        {isOwner && (
          <DropdownMenuItem asChild>
            <Link href="/settings/team">
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/settings/plan">
            <UserRound /> Plan &amp; modules
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            // Keep the menu mounted while the action runs, or the redirect races
            // the unmount and the click appears to do nothing.
            event.preventDefault();
            start(() => {
              void signOut();
            });
          }}
          className="text-blocked-fg data-[highlighted]:bg-blocked-bg"
        >
          <LogOut /> {pending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
