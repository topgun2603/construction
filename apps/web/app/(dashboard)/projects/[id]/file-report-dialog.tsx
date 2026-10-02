'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FilePlus2, ImagePlus, Loader2, Quote, X } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_UPLOAD_BYTES, type VoiceDprResult } from '@sitebook/shared';
import { fileDailyReport, presignUpload } from '@/lib/actions';
import { VoiceNoteButton } from '@/components/voice-note-button';
import { BilingualTextarea } from '@/components/bilingual-textarea';
import { useLanguage } from '@/components/language-provider';
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

/** A photo chosen but not yet uploaded. */
interface Pending {
  file: File;
  preview: string;
}

/** What a spoken note left behind: the fields it filled, and the words it was read from. */
interface Spoken {
  transcript: string;
  language: string | null;
  caveats: string[];
  manpower: { trade: string; count: number }[];
  activities: { activity: string; quantity?: string; unit?: string }[];
}

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * File a daily progress report from the web.
 *
 * The report is normally filed from the phone, on site, at the end of the day. This exists for the
 * evening it did not happen — the project manager writing it up from what the supervisor phoned in,
 * with the photographs they were sent. Same endpoint, same shape, so a report filed here is
 * indistinguishable from one filed on site except for whose name is on it.
 */
export function FileReportDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Pending[]>([]);
  /*
   * The form's fields live here rather than in the DOM so a spoken note can fill them.
   *
   * Still uncontrolled inputs underneath — `defaultValue` plus a remount key. A controlled
   * textarea on a form this size means a re-render per keystroke for no benefit, and the only
   * thing that ever writes these from outside is the voice draft.
   */
  const [fields, setFields] = useState({
    report_date: TODAY(),
    weather: '',
    work_done: '',
    issues: '',
    headcount: '',
  });
  const [formKey, setFormKey] = useState(0);
  const [spoken, setSpoken] = useState<Spoken | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // Object URLs are a leak if nobody revokes them; a dialog opened and closed twenty times over an
  // evening would otherwise hold twenty sets of full-size images in memory.
  useEffect(() => {
    return () => photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
  }, [photos]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted: Pending[] = [];
    for (const file of [...list]) {
      if (file.size > MAX_UPLOAD_BYTES.image) {
        toast.error(
          `${file.name} is too large — photos are limited to ${Math.round(MAX_UPLOAD_BYTES.image / 1024 / 1024)} MB`,
        );
        continue;
      }
      accepted.push({ file, preview: URL.createObjectURL(file) });
    }
    setPhotos((current) => [...current, ...accepted]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index]!.preview);
      return current.filter((_, position) => position !== index);
    });
  }

  /**
   * A spoken note arrived. Fill the form with it and show the words it came from.
   *
   * Filling, not filing. Every field stays editable and nothing is submitted — the draft is a head
   * start on typing, and the transcript above it is how somebody checks the head start was right.
   */
  function applyDraft(result: VoiceDprResult) {
    setError(null);
    const total = result.draft.manpower.reduce((sum, row) => sum + row.count, 0);
    setFields((current) => ({
      report_date: result.draft.report_date || current.report_date,
      // A note that mentioned no weather should not blank a weather somebody already typed.
      weather: result.draft.weather ?? current.weather,
      work_done: result.draft.work_done ?? current.work_done,
      issues: result.draft.issues ?? current.issues,
      headcount: total > 0 ? String(total) : current.headcount,
    }));
    setSpoken({
      transcript: result.transcript,
      language: result.language,
      caveats: result.caveats,
      manpower: result.draft.manpower,
      activities: result.draft.activities,
    });
    setFormKey((key) => key + 1);
  }

  function onSubmit(formData: FormData) {
    const workDone = String(formData.get('work_done') ?? '').trim();
    if (!workDone) {
      setError('Say what got done — that is the whole point of the report.');
      return;
    }
    setError(null);

    start(async () => {
      /*
       * Photos go up before the report does. If one fails, nothing has been filed and the form is
       * still in front of the person — filing first and uploading after would leave a report
       * claiming photographs that are not there.
       */
      const keys: Array<{ s3_key: string }> = [];
      for (const [index, photo] of photos.entries()) {
        setUploading(index + 1);
        const presigned = await presignUpload({
          kind: 'dpr_photo',
          content_type: photo.file.type,
          content_length: photo.file.size,
          project_id: projectId,
        });
        if (!presigned.ok || !presigned.data) {
          setUploading(null);
          setError(presigned.error ?? `Could not prepare ${photo.file.name}`);
          return;
        }
        // Straight to storage. The signed headers must be replayed exactly or the PUT is rejected.
        const put = await fetch(presigned.data.url, {
          method: 'PUT',
          headers: presigned.data.headers,
          body: photo.file,
        });
        if (!put.ok) {
          setUploading(null);
          setError(`Upload failed for ${photo.file.name}`);
          return;
        }
        keys.push({ s3_key: presigned.data.s3_key });
      }
      setUploading(null);

      const headcount = Number.parseInt(String(formData.get('headcount') ?? ''), 10);
      const result = await fileDailyReport({
        project_id: projectId,
        report_date: String(formData.get('report_date') ?? ''),
        work_done: workDone,
        issues: String(formData.get('issues') ?? '').trim() || undefined,
        weather: String(formData.get('weather') ?? '').trim() || undefined,
        manpower: manpowerFor(headcount, spoken),
        activities: spoken?.activities ?? [],
        photos: keys,
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not file the report');
        return;
      }
      toast.success(t('Report filed'));
      setPhotos([]);
      setSpoken(null);
      setFields({ report_date: TODAY(), weather: '', work_done: '', issues: '', headcount: '' });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <FilePlus2 className="size-4" /> {t('File a report')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('Daily report')} — {projectName}
          </DialogTitle>
          <DialogDescription>{t('What got done, who was on site, and what is in the way.')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-line bg-raised px-3 py-2.5">
          <p className="text-[12.5px] text-ink-muted">{t('Rather say it? Two lines in Tamil, Hindi or English fills the form in.')}</p>
          <VoiceNoteButton
            projectId={projectId}
            reportDate={fields.report_date}
            onDraft={applyDraft}
            onError={setError}
            disabled={pending}
          />
        </div>

        {spoken && (
          <figure className="rounded-panel border border-line bg-surface p-3">
            <figcaption className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              <Quote className="size-3" />
              {t('What was said')}
              {spoken.language ? ` · heard as ${spokenLanguageName(spoken.language)}` : ''}
            </figcaption>
            {/* Verbatim and in the speaker's own script. It is the only thing on this screen that
                can be checked against a memory, so it is not translated, trimmed or tidied. */}
            <blockquote className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
              {spoken.transcript}
            </blockquote>
            {spoken.manpower.length > 0 && (
              <p className="mt-2 text-[12px] text-ink-muted">
                {spoken.manpower.map((row) => `${row.count} ${row.trade}`).join(' · ')}
              </p>
            )}
            {spoken.activities.length > 0 && (
              <p className="mt-1 text-[12px] text-ink-muted">
                {spoken.activities
                  .map((row) =>
                    row.quantity ? `${row.activity} — ${row.quantity} ${row.unit ?? ''}`.trim() : row.activity,
                  )
                  .join(' · ')}
              </p>
            )}
            {spoken.caveats.map((caveat) => (
              <p key={caveat} className="mt-1.5 text-[12px] text-attention-fg">
                {caveat}
              </p>
            ))}
          </figure>
        )}

        <form key={formKey} action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Date')} htmlFor="report_date">
              <Input
                id="report_date"
                name="report_date"
                type="date"
                required
                defaultValue={fields.report_date}
                max={TODAY()}
              />
            </Field>
            <Field label={t('Weather')} htmlFor="weather" hint={t('Optional')}>
              <Input
                id="weather"
                name="weather"
                placeholder={t('Clear')}
                maxLength={120}
                defaultValue={fields.weather}
              />
            </Field>
          </div>

          {/* The two prose fields translate as you type. They are the ones a supervisor reads —
              the date and the headcount need no translating, and wrapping them would just put a
              vendor call behind typing a number. */}
          <Field label={t('What got done today')} htmlFor="work_done">
            <BilingualTextarea
              id="work_done"
              name="work_done"
              rows={4}
              required
              maxLength={4000}
              defaultValue={fields.work_done}
              placeholder={t('Second floor slab shuttering completed, curing started on the columns…')}
            />
          </Field>

          <Field label={t('Anything in the way')} htmlFor="issues" hint={t('Left blank if nothing is')}>
            <BilingualTextarea
              id="issues"
              name="issues"
              rows={3}
              maxLength={4000}
              defaultValue={fields.issues}
              placeholder={t('Sand delivery did not arrive; masonry on hold from tomorrow')}
            />
          </Field>

          <Field label={t('People on site')} htmlFor="headcount" hint={t('Optional')}>
            <Input id="headcount" name="headcount" inputMode="numeric" placeholder="24" />
          </Field>

          <Field label={t('Photos')} hint={t('What the report is describing')}>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex size-24 flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed border-line-strong bg-raised text-[12px] text-ink-muted transition hover:border-accent hover:text-accent"
              >
                <ImagePlus className="size-5" />
                {t('Add photos')}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              {photos.map((photo, index) => (
                <span key={photo.preview} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.preview}
                    alt=""
                    className="size-24 rounded-panel border border-line object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    aria-label={`Remove ${photo.file.name}`}
                    className="absolute right-1 top-1 grid size-6 min-h-0 place-items-center rounded-full bg-ink/70 text-white transition hover:bg-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </Field>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {uploading === null ? 'Filing…' : `Photo ${uploading} of ${photos.length}`}
                </>
              ) : photos.length === 0 ? (
                'File report'
              ) : (
                `File report with ${photos.length} photo${photos.length === 1 ? '' : 's'}`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The headcount to file: the spoken breakdown, or the single number somebody typed.
 *
 * One rule, so it is predictable. If the total in the field still matches what the note added up
 * to, the trade split is what gets filed — "8 masons, 4 helpers" is worth more to whoever reads the
 * report than "12 on site". The moment somebody changes that number they are overriding the note,
 * and a split that no longer adds up to the stated total would be worse than no split at all.
 */
function manpowerFor(
  headcount: number,
  spoken: Spoken | null,
): { trade: string; count: number }[] {
  if (!Number.isFinite(headcount) || headcount <= 0) return [];
  const spokenTotal = spoken?.manpower.reduce((sum, row) => sum + row.count, 0) ?? 0;
  if (spoken && spokenTotal === headcount) return spoken.manpower;
  // One line rather than a trade breakdown, matching the phone form: "24 people" is what somebody
  // actually types, and a form that demands the split gets abandoned.
  return [{ trade: 'On site', count: headcount }];
}

/** The transcriber's language code, in words. Anything unexpected is shown as it came. */
function spokenLanguageName(code: string): string {
  const names: Record<string, string> = {
    ta: 'Tamil',
    tamil: 'Tamil',
    hi: 'Hindi',
    hindi: 'Hindi',
    te: 'Telugu',
    telugu: 'Telugu',
    kn: 'Kannada',
    kannada: 'Kannada',
    ml: 'Malayalam',
    malayalam: 'Malayalam',
    en: 'English',
    english: 'English',
  };
  return names[code.toLowerCase()] ?? code;
}
