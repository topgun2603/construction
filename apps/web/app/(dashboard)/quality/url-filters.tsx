'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { ANY, filterQuery } from './labels';

export interface UrlFilterField {
  key: string;
  /** What "no filter" reads as: "All sites". Already translated. */
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}

/**
 * Pickers (and optionally a date range) that write to the URL, for the Inspections, Tests and
 * Reports tabs. The page reads them back as search params, so what is on screen is always what a
 * reload — or a link sent to somebody else — shows.
 */
export function UrlFilters({
  tab,
  values,
  fields,
  dates = false,
}: {
  tab: string;
  values: Record<string, string | undefined>;
  fields: UrlFilterField[];
  dates?: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();

  function apply(next: Record<string, string | undefined>) {
    router.push(`${pathname}?${filterQuery({ tab, ...values, ...next })}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {fields
        .filter((field) => field.options.length > 0)
        .map((field) => (
          <Select key={field.key} value={values[field.key] ?? ANY} onValueChange={(value) => apply({ [field.key]: value })}>
            <SelectTrigger className="h-9 w-[170px] text-[13.5px]" aria-label={field.placeholder}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{field.placeholder}</SelectItem>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      {dates && (
        <>
          <Input
            type="date"
            value={values.from ?? ''}
            max={values.to}
            onChange={(event) => apply({ from: event.target.value })}
            className="h-9 w-[160px]"
            aria-label={t('From date')}
          />
          <span className="text-ink-muted rtl:rotate-180">→</span>
          <Input
            type="date"
            value={values.to ?? ''}
            min={values.from}
            onChange={(event) => apply({ to: event.target.value })}
            className="h-9 w-[160px]"
            aria-label={t('To date')}
          />
        </>
      )}
    </div>
  );
}
