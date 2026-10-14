'use client';

import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ExportFilters = Record<string, string | number | boolean | null | undefined>;

/** `/excel/export/<kind>?…`: the route handler that relays to the API with the session. */
export function exportHref(kind: string, filters: ExportFilters = {}, format: 'xlsx' | 'csv' = 'xlsx'): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  if (format === 'csv') query.set('format', 'csv');
  const text = query.toString();
  return `/excel/export/${kind}${text ? `?${text}` : ''}`;
}

/**
 * "Export" on a table: Excel or CSV, with the filters the screen has applied (roadmap Phase 3,
 * item 4).
 *
 * Excel is the shared export — typed cells, the company's currency, a frozen header. CSV stays what
 * it was where a table already had one (`csvHref`), so a link somebody bookmarked or a script that
 * reads it keeps working; elsewhere it is the same export as CSV. What either contains is decided by
 * the API, by the same rules as the screen.
 */
export function ExportMenu({
  kind,
  filters,
  csvHref,
  label,
  size = 'sm',
}: {
  kind: string;
  filters?: ExportFilters;
  /** The table's existing CSV export, kept as it was. */
  csvHref?: string;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const { t } = useLanguage();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size={size}>
          <Download className="size-4" />
          {label ?? t('Export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('Download what is shown')}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={exportHref(kind, filters)} download>
            <FileSpreadsheet />
            {t('Excel (.xlsx)')}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={csvHref ?? exportHref(kind, filters, 'csv')} download>
            <FileText />
            {t('CSV')}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
