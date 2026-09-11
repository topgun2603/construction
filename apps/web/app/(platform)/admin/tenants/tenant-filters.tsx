'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Filters for the tenant list.
 *
 * The page already read `search`, `status` and `plan` from the URL — there was simply no
 * way to set them except by typing the query string. State lives in the URL so a filtered
 * view can be pasted into a support thread.
 *
 * Search is debounced; the selects navigate immediately. Typing a name is a stream of
 * keystrokes and a request per character would queue up renders behind the user, while
 * picking "suspended" is one deliberate act.
 */
export function TenantFilters({
  search,
  status,
  plan,
}: {
  search: string;
  status: string;
  plan: string;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(search);

  function push(next: { search?: string; status?: string; plan?: string }) {
    const query = new URLSearchParams();
    const value = {
      search: next.search ?? term,
      status: next.status ?? status,
      plan: next.plan ?? plan,
    };
    if (value.search) query.set('search', value.search);
    if (value.status) query.set('status', value.status);
    if (value.plan) query.set('plan', value.plan);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    router.push(`/admin/tenants${suffix}`);
  }

  // Debounced so the list follows typing without a request per keystroke. Skipped when
  // the box already matches the URL, which is what stops this firing on first paint.
  useEffect(() => {
    if (term === search) return;
    const timer = setTimeout(() => {
      const query = new URLSearchParams();
      if (term) query.set('search', term);
      if (status) query.set('status', status);
      if (plan) query.set('plan', plan);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      router.push(`/admin/tenants${suffix}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [term, search, status, plan, router]);

  const filtered = Boolean(search || status || plan);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search name or owner number"
          className="w-[280px] pl-9"
          aria-label="Search tenants"
        />
      </div>

      <Segmented
        label="Status"
        value={status}
        options={[
          { value: '', label: 'All' },
          { value: 'active', label: 'Active' },
          { value: 'suspended', label: 'Suspended' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
        onChange={(value) => push({ status: value })}
      />

      <Segmented
        label="Plan"
        value={plan}
        options={[
          { value: '', label: 'All' },
          { value: 'starter', label: 'Starter' },
          { value: 'pro', label: 'Pro' },
        ]}
        onChange={(value) => push({ plan: value })}
      />

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm('');
            router.push('/admin/tenants');
          }}
        >
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-btn bg-neutral-bg p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value || 'all'}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-0 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium transition',
            value === option.value
              ? 'bg-surface font-semibold text-ink shadow-seg'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
