'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Building2, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/components/language-provider';
import { switchCompany } from '@/lib/company-group-actions';
import type { CompanyMembership } from '@/lib/company-group-types';
import { cn } from '@/lib/utils';

/**
 * Which company this session is in, and the way into the others (Phase 2, module 11).
 *
 * Self-contained so it can sit anywhere in the header: it takes the membership list the dashboard
 * layout already loaded and renders nothing at all for the — overwhelmingly common — person who
 * belongs to one company, so a single-company account sees no change.
 *
 * Choosing a company asks the server to swap the session: the API issues a token for exactly that
 * company (RLS stays single-tenant per request) and the old one is revoked. Then the app reloads
 * from the root, because every number on screen belonged to the company just left.
 */
export function CompanySwitcher({
  memberships,
  className,
}: {
  memberships: CompanyMembership[];
  className?: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();

  if (memberships.length < 2) return null;
  const current = memberships.find((membership) => membership.current) ?? memberships[0];

  function choose(membership: CompanyMembership) {
    if (membership.current) return;
    start(async () => {
      const result = await switchCompany(membership.tenant_id);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not switch company'));
        return;
      }
      toast.success(`${t('Now working in')} ${membership.tenant_name}`);
      router.replace('/');
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-10 max-w-[9rem] items-center sm:max-w-[14rem] gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13.5px] font-medium text-ink transition hover:bg-raised',
          className,
        )}
        aria-label={t('Switch company')}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="size-4 flex-none animate-spin text-ink-muted" />
        ) : (
          <Building2 className="size-4 flex-none text-ink-muted" />
        )}
        <span className="truncate">{current?.tenant_name}</span>
        <ChevronsUpDown className="size-3.5 flex-none text-ink-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('Your companies')}</DropdownMenuLabel>
        {memberships.map((membership) => (
          <DropdownMenuItem
            key={membership.tenant_id}
            onSelect={() => choose(membership)}
            className="items-start"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-ink">{membership.tenant_name}</span>
              <span className="truncate text-[12px] text-ink-muted">
                {t(membership.role_name)} · {membership.currency}
                {membership.status === 'pending' ? ` · ${t('Not signed in yet')}` : ''}
              </span>
            </span>
            {membership.current && <Check className="mt-0.5 text-accent" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
