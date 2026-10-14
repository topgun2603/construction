'use client';

import { useRef, useState, useTransition } from 'react';
import { Camera, Loader2, Ruler, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { boqMeasuredQuantity, quantityToThousandths, thousandthsToQuantity } from '@sitebook/shared';
import { presignUpload } from '@/lib/actions';
import { listBoqMeasurements, recordBoqMeasurement, removeBoqMeasurement } from '@/lib/boq-actions';
import { boqPercent, type BoqItem, type BoqItemProgress, type BoqMeasurement } from '@/lib/boq-types';
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
import { ProgressBar } from '@/components/ui/meter';

const DIMENSIONS = ['count', 'length', 'breadth', 'height'] as const;
type Dimension = (typeof DIMENSIONS)[number];
const DIMENSION_LABEL: Record<Dimension, string> = { count: 'Nos.', length: 'Length', breadth: 'Breadth', height: 'Height' };

const tryQuantity = (value: string): bigint | null => {
  if (!value.trim()) return null;
  try {
    return quantityToThousandths(value.trim());
  } catch {
    return null;
  }
};

/**
 * The measurement book for one item: record what was measured — a count, or length × breadth ×
 * height, or any of them — with where and a photo, and see every entry so far. The quantity is
 * worked out as it is typed, with the same function the API stores it with.
 */
export function BoqMeasureDialog({
  projectId,
  item,
  canManage,
}: {
  projectId: string;
  item: BoqItem;
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const photoInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [entries, setEntries] = useState<BoqMeasurement[] | null>(null);
  const [progress, setProgress] = useState<BoqItemProgress | null>(null);
  const [measuredOn, setMeasuredOn] = useState(format.todayIso());
  const [location, setLocation] = useState('');
  const [dims, setDims] = useState<Record<Dimension, string>>({ count: '', length: '', breadth: '', height: '' });
  const [deduction, setDeduction] = useState(false);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const parsed = Object.fromEntries(DIMENSIONS.map((key) => [key, tryQuantity(dims[key])])) as Record<Dimension, bigint | null>;
  const invalid = DIMENSIONS.some((key) => dims[key].trim() !== '' && parsed[key] === null);
  const quantity = invalid ? null : boqMeasuredQuantity(parsed, deduction);

  function load(next: boolean) {
    setOpen(next);
    if (!next) return;
    start(async () => {
      const result = await listBoqMeasurements(item.id);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not load the measurements'));
        return;
      }
      setEntries(result.data.items);
      setProgress(result.data.item);
    });
  }

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const presigned = await presignUpload({
        kind: 'site_media',
        content_type: file.type || 'image/jpeg',
        content_length: file.size,
        project_id: projectId,
      });
      if (!presigned.ok || !presigned.data) {
        toast.error(presigned.error ?? t('Could not prepare the upload'));
        return;
      }
      const put = await fetch(presigned.data.url, { method: 'PUT', headers: presigned.data.headers, body: file });
      if (!put.ok) {
        toast.error(t('The upload failed'));
        return;
      }
      setPhotos((current) => [...current, presigned.data!.s3_key]);
    } finally {
      setUploading(false);
    }
  }

  function save() {
    if (quantity === null || quantity === 0n) {
      toast.error(t('Enter a number or at least one dimension'));
      return;
    }
    const body = Object.fromEntries(
      DIMENSIONS.filter((key) => parsed[key] !== null).map((key) => [key, thousandthsToQuantity(parsed[key]!)]),
    );
    start(async () => {
      const result = await recordBoqMeasurement(projectId, item.id, {
        measured_on: measuredOn,
        ...body,
        deduction,
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        photo_keys: photos,
        client_id: crypto.randomUUID(),
      });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(`${thousandthsToQuantity(quantity)} ${item.unit ?? ''} ${t('recorded')}`);
      setEntries((current) => [result.data!.measurement, ...(current ?? [])]);
      setProgress(result.data.item);
      setDims({ count: '', length: '', breadth: '', height: '' });
      setDeduction(false);
      setNote('');
      setPhotos([]);
    });
  }

  function remove(entry: BoqMeasurement) {
    start(async () => {
      const result = await removeBoqMeasurement(projectId, entry.id);
      if (!result.ok) {
        toast.error(result.error ?? t('Could not remove that'));
        return;
      }
      load(true);
    });
  }

  const shown = progress ?? {
    measured_quantity: item.measured_quantity ?? '0',
    percent_bp: item.percent_bp,
    over: item.over,
    excess_quantity: item.excess_quantity ?? '0',
  };
  const percent = shown.percent_bp / 100;

  return (
    <Dialog open={open} onOpenChange={load}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8 text-ink-faint" aria-label={`${t('Measure')} ${item.item_no}`}>
          <Ruler className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="me-1.5 font-mono text-ink-muted" dir="ltr">
              {item.item_no}
            </span>
            {item.description}
          </DialogTitle>
          <DialogDescription>
            {t('Contract')} {item.quantity} {item.unit} · {t('measured')} {shown.measured_quantity} {item.unit} ·{' '}
            {boqPercent(shown.percent_bp)}
          </DialogDescription>
        </DialogHeader>
        <ProgressBar percent={Math.min(percent, 100)} overflowPercent={shown.over ? Math.min(percent - 100, 100) : 0} />
        {shown.over && (
          <Badge tone="blocked">
            {shown.excess_quantity} {item.unit} {t('over the contract quantity — it will need a variation')}
          </Badge>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Measured on')}>
            <Input type="date" value={measuredOn} onChange={(event) => setMeasuredOn(event.target.value)} />
          </Field>
          <Field label={t('Where')} optional>
            <Input
              value={location}
              maxLength={300}
              placeholder={t('Block B, 2nd floor slab')}
              onChange={(event) => setLocation(event.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DIMENSIONS.map((key) => (
            <Field key={key} label={t(DIMENSION_LABEL[key])} optional>
              <Input
                value={dims[key]}
                inputMode="decimal"
                dir="ltr"
                className={parsed[key] === null && dims[key].trim() ? 'border-blocked font-mono' : 'font-mono'}
                onChange={(event) => setDims((current) => ({ ...current, [key]: event.target.value }))}
              />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={deduction} onChange={(event) => setDeduction(event.target.checked)} />
            {t('Deduction (an opening, or something measured twice)')}
          </label>
          <span className="font-mono text-[15px] font-semibold">
            = {quantity === null ? '—' : `${thousandthsToQuantity(quantity)} ${item.unit ?? ''}`}
          </span>
        </div>
        <Field label={t('Note')} optional>
          <Input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              void addPhoto(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => photoInput.current?.click()} disabled={uploading || photos.length >= 10}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {t('Add photo')}
          </Button>
          {photos.length > 0 && (
            <span className="text-[12.5px] text-ink-muted">
              {photos.length} {t('attached')}
            </span>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Close')}
          </Button>
          <Button onClick={save} disabled={pending || uploading || quantity === null}>
            {t('Record measurement')}
          </Button>
        </DialogFooter>

        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Measurement book')}</span>
          {entries === null ? (
            <Loader2 className="size-4 animate-spin text-ink-faint" />
          ) : entries.length === 0 ? (
            <p className="text-[13.5px] text-ink-muted">{t('Nothing measured yet.')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-1.5">
                  <div className="flex min-w-0 flex-col">
                    <span>
                      {format.shortDate(entry.measured_on)}
                      {entry.location && ` · ${entry.location}`}
                      {entry.photo_keys.length > 0 && ` · ${entry.photo_keys.length} ${t('photos')}`}
                    </span>
                    <span className="font-mono text-[12px] text-ink-muted" dir="ltr">
                      {[entry.count, entry.length, entry.breadth, entry.height].filter(Boolean).join(' × ')}
                    </span>
                    <span className="text-[12px] text-ink-faint">
                      {entry.measured_by.name}
                      {entry.note && ` · ${entry.note}`}
                    </span>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <span className={entry.deduction ? 'font-mono text-blocked-fg' : 'font-mono'}>
                      {entry.quantity} {item.unit}
                    </span>
                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-ink-faint"
                        aria-label={t('Remove')}
                        disabled={pending}
                        onClick={() => remove(entry)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
