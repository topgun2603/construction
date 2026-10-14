'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  IMPORT_KIND_SPECS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportCommitInput,
  type ImportFileInput,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
} from '@sitebook/shared';
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

type ImportProblem = { row: number | null; field: string | null; message: string };
type Relayed<T> = { ok: true; data: T } | { ok: false; error: string; problems: ImportProblem[] };

/** Through the `/excel/import` route handler; see there for why it is not a server action. */
async function relay<T>(step: 'preview' | 'commit', body: ImportFileInput | ImportCommitInput): Promise<Relayed<T>> {
  try {
    const response = await fetch(`/excel/import?step=${step}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | (T & { message?: string; details?: { errors?: ImportProblem[] } })
      | null;
    if (!response.ok || !payload) {
      return {
        ok: false,
        error: payload?.message ?? 'Something went wrong. Try again.',
        problems: payload?.details?.errors ?? [],
      };
    }
    return { ok: true, data: payload };
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again.', problems: [] };
  }
}

/** The problem rows as a workbook, saved through a temporary link. */
async function downloadErrorReport(body: ImportFileInput): Promise<boolean> {
  const response = await fetch('/excel/import?step=error-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return false;
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name ? decodeURIComponent(name) : 'import-errors.xlsx';
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Import from Excel or CSV, for any kind of record (roadmap Phase 3, item 4): download the template,
 * upload, pick the sheet, check the column mapping, read the preview with every row's problems, then
 * import every row or nothing — or only the rows that are fine, with the rest as a downloadable
 * report.
 *
 * Every step is the server's reading of the file, by the same rules as the Add form, so the preview
 * is exactly what the import will do. `projects` is offered for the imports that go into one site.
 */
export function ImportWizard({
  kind,
  projectId,
  projects,
  label,
}: {
  kind: ImportKind;
  /** The site the import goes into (cost codes), fixed by the screen. */
  projectId?: string;
  /** Sites to pick from, for an import that can take one default site (opening stock). */
  projects?: Array<{ id: string; name: string }>;
  label?: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const spec = IMPORT_KIND_SPECS[kind];
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [sheet, setSheet] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<'all' | 'valid_only'>('all');
  const [site, setSite] = useState<string | undefined>(projectId);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [problems, setProblems] = useState<ImportProblem[]>([]);

  function reset(next: boolean) {
    setOpen(next);
    if (next) return;
    setFile(null);
    setPreview(null);
    setMapping({});
    setSheet(undefined);
    setResult(null);
    setProblems([]);
    setMode('all');
  }

  function body(overrides: Partial<ImportFileInput> = {}): ImportFileInput | null {
    if (!file) return null;
    return {
      kind,
      file_name: file.name,
      content_base64: file.base64,
      ...(sheet ? { sheet } : {}),
      ...(site ? { project_id: site } : {}),
      ...(preview ? { mapping, header_row: preview.header_row } : {}),
      ...overrides,
    };
  }

  function check(request: ImportFileInput | null) {
    if (!request) return;
    start(async () => {
      const response = await relay<ImportPreview>('preview', request);
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setPreview(response.data);
      setMapping(response.data.mapping);
      setSheet(response.data.sheet ?? undefined);
      setProblems([]);
      setResult(null);
    });
  }

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    if (!/\.(xlsx|csv)$/i.test(chosen.name)) {
      toast.error(t('Choose an .xlsx or .csv file'));
      return;
    }
    if (chosen.size > IMPORT_MAX_BYTES) {
      toast.error(t('That file is larger than 5 MB. Split it into smaller files.'));
      return;
    }
    const base64 = await readAsBase64(chosen);
    setFile({ name: chosen.name, base64 });
    setPreview(null);
    // First reading: the server finds the header row and matches the columns.
    check({ kind, file_name: chosen.name, content_base64: base64, ...(site ? { project_id: site } : {}) });
  }

  function commit() {
    const request = body();
    if (!request) return;
    start(async () => {
      const response = await relay<ImportResult>('commit', { ...request, mode });
      if (!response.ok) {
        toast.error(response.error);
        setProblems(response.problems);
        return;
      }
      setResult(response.data);
      toast.success(`${response.data.imported} ${t('rows imported')}`);
      router.refresh();
    });
  }

  function errorReport() {
    const request = body();
    if (!request) return;
    start(async () => {
      if (!(await downloadErrorReport(request))) toast.error(t('Could not make the error report. Try again.'));
    });
  }

  const columns = preview?.headers ?? [];
  const needsSite = spec.scope === 'project' && !site;
  const shownProblems: ImportProblem[] = problems.length > 0 ? problems : (preview?.errors ?? []);

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload className="size-4" />
          {label ?? t('Import')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('Import')} {t(spec.title).toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {t('From an Excel (.xlsx) or CSV file. Nothing is saved until you have checked the preview.')}{' '}
            {t('At most')} {IMPORT_MAX_ROWS.toLocaleString()} {t('rows and 5 MB per file.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <a
            href={`/excel/template/${kind}`}
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-control px-1 text-[13px] text-accent hover:underline"
          >
            <Download className="size-4" />
            {t('Download the template')}
          </a>
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
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={pending || needsSite}>
            <FileSpreadsheet className="size-4" />
            {file ? file.name : t('Choose a file')}
          </Button>
          {projects && !projectId && (
            <Field label={spec.scope === 'project' ? t('Site') : t('Site, for rows that name none')} className="min-w-[220px]">
              <Select
                value={site ?? 'none'}
                onValueChange={(value) => {
                  const next = value === 'none' ? undefined : value;
                  setSite(next);
                  if (preview) check(body({ project_id: next }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {spec.scope !== 'project' && <SelectItem value="none">{t('Named on each row')}</SelectItem>}
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {preview && preview.sheets.length > 1 && (
            <Field label={t('Worksheet')} className="min-w-[180px]">
              <Select
                value={sheet ?? preview.sheets[0]}
                onValueChange={(value) => {
                  setSheet(value);
                  // A different sheet has different columns: let the server match them again.
                  check({ kind, file_name: file!.name, content_base64: file!.base64, sheet: value, ...(site ? { project_id: site } : {}) });
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

        {preview && !result && (
          <>
            <div className="flex flex-col gap-2 rounded-panel border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Columns')}</span>
                <span className="text-[12.5px] text-ink-faint">
                  {t('Headers on row')} {preview.header_row + 1}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {spec.fields.map((field) => (
                  <Field key={field.key} label={`${t(field.label)}${field.required ? ' *' : ''}`}>
                    <Select
                      value={mapping[field.key] === null || mapping[field.key] === undefined ? 'none' : String(mapping[field.key])}
                      onValueChange={(value) =>
                        setMapping((current) => ({ ...current, [field.key]: value === 'none' ? null : Number(value) }))
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
                <Button variant="secondary" size="sm" onClick={() => check(body())} disabled={pending}>
                  {t('Check again with these columns')}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Badge tone="neutral" dot={false}>
                {preview.total_rows} {t('rows')}
              </Badge>
              <Badge tone="done" dot={false}>
                {preview.valid_rows} {t('ready')}
              </Badge>
              {preview.error_rows > 0 && (
                <Badge tone="blocked">
                  {preview.error_rows} {t('with problems')}
                </Badge>
              )}
              {preview.skipped_rows > 0 && (
                <Badge tone="neutral" dot={false}>
                  {preview.skipped_rows} {t('skipped')}
                </Badge>
              )}
              {preview.error_rows > 0 && (
                <Button variant="ghost" size="sm" onClick={errorReport} disabled={pending}>
                  <Download className="size-4" />
                  {t('Download the problem rows')}
                </Button>
              )}
            </div>

            {shownProblems.length > 0 && (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-panel bg-blocked-bg p-3 text-[13px] text-blocked-fg">
                {shownProblems.slice(0, 300).map((problem, index) => (
                  <li key={index}>
                    {problem.row !== null && (
                      <span className="me-1.5 font-mono">
                        {t('Row')} {problem.row}:
                      </span>
                    )}
                    {problem.message}
                  </li>
                ))}
              </ul>
            )}

            <div className="max-h-72 overflow-auto rounded-panel border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-raised">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t('Row')}</th>
                    {spec.fields
                      .filter((field) => mapping[field.key] !== null && mapping[field.key] !== undefined)
                      .map((field) => (
                        <th key={field.key} className="whitespace-nowrap px-2 py-1.5 text-start">
                          {t(field.label)}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.row}
                      className={cn(
                        'border-t border-line-soft',
                        row.status === 'error' && 'bg-blocked-bg',
                        row.status === 'skipped' && 'text-ink-faint',
                      )}
                      title={row.issues.map((issue) => issue.message).join('\n')}
                    >
                      <td className="px-2 py-1 font-mono text-ink-faint">{row.row}</td>
                      {spec.fields
                        .filter((field) => mapping[field.key] !== null && mapping[field.key] !== undefined)
                        .map((field) => (
                          <td
                            key={field.key}
                            className={cn(
                              'px-2 py-1',
                              row.issues.some((issue) => issue.field === field.key) && 'font-medium text-blocked-fg',
                            )}
                          >
                            {row.values[field.key]}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Field label={t('How to import')} className="max-w-md">
              <Select value={mode} onValueChange={(value) => setMode(value as 'all' | 'valid_only')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('Every row, or nothing if any row has a problem')}</SelectItem>
                  <SelectItem value="valid_only">{t('Only the rows without problems')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </>
        )}

        {result && (
          <div className="flex flex-col gap-2 rounded-panel border border-line p-3 text-[13.5px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="done">
                {result.imported} {t('imported')}
              </Badge>
              {result.failed > 0 && (
                <Badge tone="blocked">
                  {result.failed} {t('not imported')}
                </Badge>
              )}
              {result.skipped > 0 && (
                <Badge tone="neutral" dot={false}>
                  {result.skipped} {t('skipped')}
                </Badge>
              )}
            </div>
            {result.failed > 0 && (
              <>
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-panel bg-blocked-bg p-3 text-[13px] text-blocked-fg">
                  {result.errors.slice(0, 300).map((problem, index) => (
                    <li key={index}>
                      <span className="me-1.5 font-mono">
                        {t('Row')} {problem.row}:
                      </span>
                      {problem.message}
                    </li>
                  ))}
                </ul>
                <div>
                  <Button variant="secondary" size="sm" onClick={errorReport} disabled={pending}>
                    <Download className="size-4" />
                    {t('Download the rows that were not imported')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => reset(false)}>
            {result ? t('Close') : t('Cancel')}
          </Button>
          {!result && (
            <Button
              onClick={commit}
              disabled={pending || !preview || preview.valid_rows === 0 || (mode === 'all' && preview.error_rows > 0)}
            >
              {mode === 'all' ? t('Import') : `${t('Import')} ${preview?.valid_rows ?? 0} ${t('rows')}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
