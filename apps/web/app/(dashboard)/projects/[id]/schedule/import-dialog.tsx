'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { COST_CODE_INDENT } from '@sitebook/shared';
import {
  importSchedule,
  previewScheduleImport,
  type ScheduleImportFormat,
} from '@/lib/schedule-actions';
import type { ScheduleImportPreview } from '@/lib/schedule-types';
import { trimScheduleXml } from '@/lib/schedule-xml';
import { addDaysIso } from '@/lib/format';
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
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const A_SUNDAY = '2026-01-04';

/**
 * A programme from MS Project or Primavera P6, as XML. Read in the browser, previewed by the API
 * without writing anything, and only then imported — replacing the site's schedule or added to it.
 */
export function ImportScheduleDialog({
  projectId,
  hasTasks,
  trigger,
}: {
  projectId: string;
  hasTasks: boolean;
  trigger?: ReactNode;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [xml, setXml] = useState<string | null>(null);
  const [trimmedNote, setTrimmedNote] = useState<string | null>(null);
  const [kind, setKind] = useState<ScheduleImportFormat>('auto');
  const [preview, setPreview] = useState<ScheduleImportPreview | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>(hasTasks ? 'append' : 'replace');
  const [useCalendar, setUseCalendar] = useState(true);

  function reset() {
    setError(null);
    setFileName(null);
    setXml(null);
    setTrimmedNote(null);
    setPreview(null);
    setMode(hasTasks ? 'append' : 'replace');
    setUseCalendar(true);
  }

  function runPreview(text: string, as: ScheduleImportFormat) {
    setPreview(null);
    start(async () => {
      const result = await previewScheduleImport(projectId, text, as);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not read that file'));
        return;
      }
      setPreview(result.data);
    });
  }

  async function onFile(file: File) {
    setError(null);
    setPreview(null);
    setFileName(file.name);
    if (fileInput.current) fileInput.current.value = '';
    const text = await file.text();
    const trimmed = trimScheduleXml(text);
    if (trimmed.tooLarge) {
      setXml(null);
      setError(
        t('This file is too large to import, even without its resources and custom fields. Export only the schedule (tasks and links) and try again.'),
      );
      return;
    }
    setTrimmedNote(
      trimmed.trimmed
        ? `${t('Resources, assignments and custom fields were left out to fit the upload')} (${Math.round(trimmed.originalBytes / 1024)} → ${Math.round(trimmed.bytes / 1024)} KB).`
        : null,
    );
    setXml(trimmed.xml);
    runPreview(trimmed.xml, kind);
  }

  function submit() {
    if (!xml || !preview) return;
    start(async () => {
      const result = await importSchedule(projectId, {
        xml,
        format: kind,
        mode,
        use_calendar: useCalendar && preview.calendar !== null,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not import that file'));
        return;
      }
      toast.success(`${result.data.created} ${t('tasks')}, ${result.data.links} ${t('links imported')}`);
      if (result.data.warnings.length > 0) toast.message(result.data.warnings.slice(0, 3).join(' · '));
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <Upload className="size-4" />
            {t('Import')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Import a programme')}</DialogTitle>
          <DialogDescription>
            {t('An XML export from Microsoft Project (File › Save As › XML) or Primavera P6. You see what is in it before anything is saved.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 rounded-card border border-line-soft bg-raised p-3.5">
          <Field label={t('File type')} className="w-[200px]">
            <Select
              value={kind}
              onValueChange={(value) => {
                const next = value as ScheduleImportFormat;
                setKind(next);
                if (xml) runPreview(xml, next);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('Work it out')}</SelectItem>
                <SelectItem value="msproject">Microsoft Project</SelectItem>
                <SelectItem value="p6">Primavera P6</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={pending}
          >
            <Upload className="size-4" />
            {fileName ? t('Choose another file') : t('Choose a file')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xml,application/xml,text/xml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          {fileName && <span className="truncate text-[13px] text-ink-muted">{fileName}</span>}
        </div>

        {trimmedNote && <p className="text-[12.5px] text-ink-muted">{trimmedNote}</p>}

        {pending && !preview && (
          <p className="flex items-center gap-2 text-[13px] text-ink-muted">
            <Loader2 className="size-4 animate-spin" />
            {t('Reading the file…')}
          </p>
        )}

        {preview && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent" dot={false}>
                {preview.format === 'p6' ? 'Primavera P6' : 'Microsoft Project'}
              </Badge>
              <Badge dot={false}>
                {preview.task_count} {t('tasks')}
              </Badge>
              <Badge dot={false}>
                {preview.summary_count} {t('summaries')}
              </Badge>
              <Badge dot={false}>
                {preview.milestone_count} {t('milestones')}
              </Badge>
              <Badge dot={false}>
                {preview.link_count} {t('links')}
              </Badge>
              {preview.start && preview.finish && (
                <Badge dot={false}>
                  {format.shortDate(preview.start)} – {format.shortDate(preview.finish)}
                </Badge>
              )}
            </div>
            {preview.project_name && (
              <p className="text-[13.5px]">
                <span className="text-ink-muted">{t('Project')}:</span> {preview.project_name}
              </p>
            )}

            <div className="max-h-64 overflow-auto rounded-card border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-raised">
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                    <th className="px-2.5 py-1.5 text-start">{t('WBS')}</th>
                    <th className="px-2.5 py-1.5 text-start">{t('Task')}</th>
                    <th className="px-2.5 py-1.5 text-end">{t('Days')}</th>
                    <th className="px-2.5 py-1.5 text-start">{t('Start')}</th>
                    <th className="px-2.5 py-1.5 text-start">{t('Finish')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.tasks.slice(0, 300).map((task) => (
                    <tr key={task.ref} className="border-b border-line-soft last:border-0">
                      <td className="px-2.5 py-1 font-mono text-ink-muted">{task.wbs ?? ''}</td>
                      <td className={cn('px-2.5 py-1', task.is_summary && 'font-semibold')}>
                        {COST_CODE_INDENT.repeat(task.depth)}
                        {task.kind === 'milestone' ? '◆ ' : ''}
                        {task.name}
                      </td>
                      <td className="px-2.5 py-1 text-end font-mono">{task.duration_days}</td>
                      <td className="px-2.5 py-1 whitespace-nowrap">{format.shortDate(task.start)}</td>
                      <td className="px-2.5 py-1 whitespace-nowrap">{format.shortDate(task.finish)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.tasks.length > 300 && (
                <p className="px-2.5 py-1.5 text-[12px] text-ink-faint">
                  {t('and')} {preview.tasks.length - 300} {t('more')}
                </p>
              )}
            </div>

            {preview.warnings.length > 0 && (
              <ul className="flex max-h-28 flex-col gap-0.5 overflow-y-auto rounded-btn bg-pending-bg px-3 py-2 text-[12.5px] text-pending-fg">
                {preview.warnings.slice(0, 30).map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('What to do with the tasks already here')}>
                <Select value={mode} onValueChange={(v) => setMode(v as 'replace' | 'append')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">{t('Replace the schedule')}</SelectItem>
                    <SelectItem value="append">{t('Add these after them')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {preview.calendar && (
                <Field
                  label={t('Calendar')}
                  hint={`${preview.calendar.name}: ${preview.calendar.working_days
                    .map((d) => format.weekday(addDaysIso(A_SUNDAY, d)))
                    .join(', ')}${preview.calendar.holidays.length ? ` · ${preview.calendar.holidays.length} ${t('holidays')}` : ''}`}
                >
                  <label className="flex h-10 items-center gap-2 text-[13.5px]">
                    <input
                      type="checkbox"
                      checked={useCalendar}
                      onChange={(e) => setUseCalendar(e.target.checked)}
                      className="size-4 accent-[rgb(var(--c-accent))]"
                    />
                    {t('Use the file’s calendar for this site')}
                  </label>
                </Field>
              )}
            </div>
            {mode === 'replace' && hasTasks && (
              <p className="rounded-btn bg-blocked-bg px-3 py-2 text-[12.5px] text-blocked-fg">
                {t('Every task and link on this site’s schedule is deleted first. Saved baselines are kept.')}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !preview || preview.task_count === 0}>
            {pending && preview && <Loader2 className="size-4 animate-spin" />}
            {t('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
