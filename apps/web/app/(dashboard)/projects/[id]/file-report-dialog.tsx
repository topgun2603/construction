'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FilePlus2, ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_UPLOAD_BYTES } from '@sitebook/shared';
import { fileDailyReport, presignUpload } from '@/lib/actions';
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
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

/** A photo chosen but not yet uploaded. */
interface Pending {
  file: File;
  preview: string;
}

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
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Pending[]>([]);
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
        // One line rather than a trade breakdown, matching the phone form: "24 people" is what
        // somebody actually types, and a form that demands the split gets abandoned.
        manpower:
          Number.isFinite(headcount) && headcount > 0
            ? [{ trade: 'On site', count: headcount }]
            : [],
        photos: keys,
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not file the report');
        return;
      }
      toast.success('Report filed');
      setPhotos([]);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <FilePlus2 className="size-4" /> File a report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Daily report — {projectName}</DialogTitle>
          <DialogDescription>
            What got done, who was on site, and what is in the way.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="report_date">
              <Input
                id="report_date"
                name="report_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label="Weather" htmlFor="weather" hint="Optional">
              <Input id="weather" name="weather" placeholder="Clear" maxLength={120} />
            </Field>
          </div>

          <Field label="What got done today" htmlFor="work_done">
            <Textarea
              id="work_done"
              name="work_done"
              rows={4}
              required
              maxLength={4000}
              placeholder="Second floor slab shuttering completed, curing started on the columns…"
            />
          </Field>

          <Field label="Anything in the way" htmlFor="issues" hint="Left blank if nothing is">
            <Textarea
              id="issues"
              name="issues"
              rows={3}
              maxLength={4000}
              placeholder="Sand delivery did not arrive; masonry on hold from tomorrow"
            />
          </Field>

          <Field label="People on site" htmlFor="headcount" hint="Optional">
            <Input id="headcount" name="headcount" inputMode="numeric" placeholder="24" />
          </Field>

          <Field label="Photos" hint="What the report is describing">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex size-24 flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed border-line-strong bg-raised text-[12px] text-ink-muted transition hover:border-accent hover:text-accent"
              >
                <ImagePlus className="size-5" />
                Add photos
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
              Cancel
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
