'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  BOQ_IMPORT_FIELDS,
  BOQ_IMPORT_FIELD_LABELS,
  BOQ_IMPORT_MAX_BYTES,
  thousandthsToQuantity,
  type BoqColumnMapping,
  type BoqImportField,
} from '@sitebook/shared';
import type { BoqImportPreview, BoqImportRequest, BoqView } from '@/lib/boq-types';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** The file as base64, which is how the API takes it: one JSON body, read on the server. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

type Relayed<T> = { ok: true; data: T } | { ok: false; error: string };

/** Through the `/boq/import` route handler; see there for why it is not a server action. */
async function relay<T>(projectId: string, step: 'preview' | 'import', body: BoqImportRequest): Promise<Relayed<T>> {
  try {
    const response = await fetch(`/boq/import?project_id=${projectId}&step=${step}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!response.ok || !payload) return { ok: false, error: payload?.message ?? 'Something went wrong. Try again.' };
    return { ok: true, data: payload };
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again.' };
  }
}

/**
 * The import wizard: pick a sheet, check the columns, read the preview, import.
 *
 * Every step is the server's reading of the file — the preview is exactly what the import will
 * store, problems and all — and the import is all or nothing, so a person fixes the sheet and tries
 * again rather than discovering half a BOQ later.
 */
export function BoqImportDialog({ projectId, canReplace }: { projectId: string; canReplace: boolean }) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>(canReplace ? 'replace' : 'append');
  const [preview, setPreview] = useState<BoqImportPreview | null>(null);
  const [mapping, setMapping] = useState<BoqColumnMapping>({});
  const [headerRow, setHeaderRow] = useState<number>(-1);
  const [sheet, setSheet] = useState<string | undefined>(undefined);

  function reset(next: boolean) {
    setOpen(next);
    if (next) return;
    setFile(null);
    setPreview(null);
    setMapping({});
    setSheet(undefined);
  }

  function request(overrides: Partial<BoqImportRequest> = {}): BoqImportRequest | null {
    if (!file) return null;
    return {
      file_name: file.name,
      content_base64: file.base64,
      mode,
      ...(sheet ? { sheet } : {}),
      ...(preview ? { mapping, header_row: headerRow } : {}),
      ...overrides,
    };
  }

  function check(body: BoqImportRequest | null) {
    if (!body) return;
    start(async () => {
      const result = await relay<BoqImportPreview>(projectId, 'preview', body);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data);
      setMapping(result.data.mapping);
      setHeaderRow(result.data.header_row);
      setSheet(result.data.sheet ?? undefined);
    });
  }

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    if (!/\.(xlsx|csv)$/i.test(chosen.name)) {
      toast.error(t('Choose an .xlsx or .csv file'));
      return;
    }
    if (chosen.size > BOQ_IMPORT_MAX_BYTES) {
      toast.error(t('That file is too large to import in one go. Split the BOQ into sections.'));
      return;
    }
    const base64 = await readAsBase64(chosen);
    setFile({ name: chosen.name, base64 });
    setPreview(null);
    // First reading: let the server find the header row and guess the columns.
    check({ file_name: chosen.name, content_base64: base64, mode });
  }

  function commit() {
    const body = request();
    if (!body) return;
    start(async () => {
      const result = await relay<{ imported: number; boq: BoqView }>(projectId, 'import', body);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.imported} ${t('rows imported')}`);
      reset(false);
      router.refresh();
    });
  }

  const columns = preview?.headers ?? [];

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload className="size-4" />
          {t('Import BOQ')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Import a bill of quantities')}</DialogTitle>
          <DialogDescription>
            {t('An Excel (.xlsx) or CSV sheet with item number, description, unit, quantity and rate or amount. Rows with figures become items; numbered rows without them become sections.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={pending}>
            <Upload className="size-4" />
            {file ? file.name : t('Choose a file')}
          </Button>
          <Field label={t('What to do with it')} className="min-w-[220px]">
            <Select
              value={mode}
              onValueChange={(value) => {
                setMode(value as 'replace' | 'append');
                if (preview) check(request({ mode: value as 'replace' | 'append' }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace" disabled={!canReplace}>
                  {t('Replace the BOQ')}
                </SelectItem>
                <SelectItem value="append">{t('Add to the BOQ')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {preview && preview.sheets.length > 1 && (
            <Field label={t('Worksheet')} className="min-w-[180px]">
              <Select
                value={sheet ?? preview.sheets[0]}
                onValueChange={(value) => {
                  setSheet(value);
                  // A different sheet has different columns: let the server guess them again.
                  check({ file_name: file!.name, content_base64: file!.base64, mode, sheet: value });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {preview.sheets.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {pending && <Loader2 className="mb-2.5 size-4 animate-spin text-ink-faint" />}
        </div>
        {!canReplace && (
          <p className="text-[12.5px] text-ink-muted">
            {t('Work has been measured or billed on this BOQ, so a sheet can only be added to it.')}
          </p>
        )}

        {preview && (
          <>
            <div className="flex flex-col gap-2 rounded-panel border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {t('Columns')}
                </span>
                <label className="flex items-center gap-2 text-[13px]">
                  {t('Headings on row')}
                  <Input
                    className="h-8 w-20 font-mono"
                    inputMode="numeric"
                    dir="ltr"
                    value={headerRow < 0 ? '' : String(headerRow + 1)}
                    placeholder={t('none')}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      setHeaderRow(Number.isFinite(value) && value > 0 ? value - 1 : -1);
                    }}
                  />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {BOQ_IMPORT_FIELDS.map((field: BoqImportField) => (
                  <Field key={field} label={t(BOQ_IMPORT_FIELD_LABELS[field])}>
                    <Select
                      value={mapping[field] === undefined ? 'none' : String(mapping[field])}
                      onValueChange={(value) =>
                        setMapping((current) => {
                          const next = { ...current };
                          if (value === 'none') delete next[field];
                          else next[field] = Number(value);
                          return next;
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('Not in the sheet')}</SelectItem>
                        {columns.map((heading, index) => (
                          <SelectItem key={index} value={String(index)}>
                            {heading || `${t('Column')} ${index + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ))}
              </div>
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => check(request())} disabled={pending}>
                  {t('Check again with these columns')}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Badge tone="neutral" dot={false}>
                {preview.sections} {t('sections')}
              </Badge>
              <Badge tone="neutral" dot={false}>
                {preview.items} {t('items')}
              </Badge>
              <Badge tone="accent" dot={false}>
                {t('Total')} {format.money(preview.total)}
              </Badge>
              {preview.errors.length > 0 ? (
                <Badge tone="blocked">
                  {preview.errors.length} {t('problems')}
                </Badge>
              ) : (
                <Badge tone="done">{t('Ready to import')}</Badge>
              )}
            </div>

            {preview.errors.length > 0 && (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-panel bg-blocked-bg p-3 text-[13px] text-blocked-fg">
                {preview.errors.map((problem, index) => (
                  <li key={index}>
                    {problem.line > 0 && (
                      <span className="me-1.5 font-mono">
                        {t('Row')} {problem.line}:
                      </span>
                    )}
                    {problem.message}
                  </li>
                ))}
              </ul>
            )}
            {preview.skipped.length > 0 && (
              <details className="text-[13px] text-ink-muted">
                <summary className="cursor-pointer">
                  {preview.skipped.length} {t('rows left out (no item number)')}
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 ps-4">
                  {preview.skipped.map((row) => (
                    <li key={row.line}>
                      {t('Row')} {row.line}: {row.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="max-h-72 overflow-auto rounded-panel border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-raised">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t('Row')}</th>
                    <th className="px-2 py-1.5 text-start">{t('Item no.')}</th>
                    <th className="px-2 py-1.5 text-start">{t('Description')}</th>
                    <th className="px-2 py-1.5 text-end">{t('Quantity')}</th>
                    <th className="px-2 py-1.5 text-end">{t('Rate')}</th>
                    <th className="px-2 py-1.5 text-end">{t('Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((row) => (
                    <tr key={row.line} className={cn('border-t border-line-soft', row.kind === 'section' && 'font-semibold')}>
                      <td className="px-2 py-1 font-mono text-ink-faint">{row.line}</td>
                      <td className="px-2 py-1 font-mono" dir="ltr">
                        {row.item_no}
                      </td>
                      <td className="px-2 py-1">{row.description}</td>
                      <td className="px-2 py-1 text-end font-mono">
                        {row.quantity === null ? '' : `${thousandthsToQuantity(BigInt(row.quantity))} ${row.unit ?? ''}`}
                      </td>
                      <td className="px-2 py-1 text-end font-mono">{row.rate === null ? '' : format.money(row.rate)}</td>
                      <td className="px-2 py-1 text-end font-mono">{row.amount === null ? '' : format.money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => reset(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={commit} disabled={pending || !preview?.can_import}>
            {mode === 'replace' ? t('Import') : t('Add to the BOQ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
