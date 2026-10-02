'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { ChevronDown, Languages, LogOut, ReceiptText, Settings, UserRound } from 'lucide-react';
import { APP_LANGUAGES } from '@sitebook/shared';
import { signOut } from '@/lib/actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BlockingOverlay } from '@/components/ui/blocking-overlay';
import { initials } from '@/components/ui/avatar';
import { titleCase } from '@/lib/format';
import { TRANSLATED_LANGUAGES } from '@/lib/i18n';
import { useLanguage } from '@/components/language-provider';

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
  const { t, language, setLanguage } = useLanguage();

  return (
    <>
      <BlockingOverlay open={pending} label={t('Signing out…')} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account menu for ${name}`}
            className="flex min-h-0 flex-none items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 transition hover:bg-neutral-bg focus-visible:outline-2"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white">
              {initials(name)}
            </span>
            <ChevronDown className="size-3.5 text-ink-faint" />
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
          <DropdownMenuLabel>{t(titleCase(role))}</DropdownMenuLabel>

          <DropdownMenuItem asChild>
            <Link href="/account">
              <UserRound /> {t('Your account')}
            </Link>
          </DropdownMenuItem>
          {isOwner && (
            <DropdownMenuItem asChild>
              <Link href="/settings/team">
                <Settings /> {t('Settings')}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/settings/plan">
              <ReceiptText /> {t('Plan &amp; modules')}
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {/* Language, where somebody looks for it: with the rest of "things about me", not buried
              in settings a supervisor has no permission to open. */}
          <DropdownMenuLabel>{t('Language')}</DropdownMenuLabel>
          {TRANSLATED_LANGUAGES.map((code) => {
            const entry = APP_LANGUAGES.find((item) => item.code === code);
            return (
              <DropdownMenuItem
                key={code}
                onSelect={(event) => {
                  event.preventDefault();
                  if (code !== language) setLanguage(code);
                }}
              >
                <Languages />
                {/* Its own name in its own script. Somebody who cannot read the interface cannot
                    read "Tamil" either, and "தமிழ்" is the one word on this screen they can. */}
                <span className={code === language ? 'font-medium text-accent' : undefined}>
                  {entry?.native ?? code}
                </span>
              </DropdownMenuItem>
            );
          })}

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
            <LogOut /> {pending ? t('Signing out…') : t('Sign out')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
