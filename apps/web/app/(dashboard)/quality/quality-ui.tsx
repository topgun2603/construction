'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Camera, ImageOff, X } from 'lucide-react';
import type { QualityPhoto, SnagPhotoStage } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import { cn } from '@/lib/utils';

/**
 * Small pieces every quality screen shares: picking photos with the phone's camera, and showing
 * the ones already attached.
 */

/**
 * Photos chosen but not yet uploaded, with previews.
 *
 * `capture="environment"` opens the rear camera straight away on a phone — the person is standing
 * in front of the defect, not browsing a gallery — and falls back to a file picker on a laptop.
 * Uploading is left to the form that owns the picker, so a cancelled dialog uploads nothing.
 */
export function PhotoPicker({
  files,
  onChange,
  max = 6,
  label,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  // Object URLs hold the image in memory until revoked; a dialog opened ten times would leak ten.
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {previews.map((url, index) => (
        <span key={url} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="size-[72px] rounded-panel border border-line object-cover" />
          <button
            type="button"
            onClick={() => onChange(files.filter((_, i) => i !== index))}
            className="absolute -end-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-line bg-surface text-ink-muted shadow-float"
            aria-label={t('Remove photo')}
            disabled={disabled}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {files.length < max && (
        <Button
          type="button"
          variant="secondary"
          className="h-[72px] min-w-[72px] flex-col gap-1 px-3 text-[12px]"
          onClick={() => input.current?.click()}
          disabled={disabled}
        >
          <Camera className="size-5" />
          {label ?? t('Photo')}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (picked.length > 0) onChange([...files, ...picked].slice(0, max));
        }}
      />
    </div>
  );
}

/** Photos already attached, as thumbnails that open full size. */
export function PhotoStrip({
  photos,
  size = 'md',
  className,
  linked = true,
}: {
  photos: QualityPhoto[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Off inside something that is already a link — a card — since links cannot nest. */
  linked?: boolean;
}) {
  const { t } = useLanguage();
  const box = size === 'sm' ? 'size-[44px]' : size === 'lg' ? 'size-[140px]' : 'size-[84px]';
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {photos.map((photo) =>
        photo.url ? (
          linked ? (
            <a key={photo.s3_key} href={photo.url} target="_blank" rel="noreferrer noopener">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={t('Photo')}
                loading="lazy"
                className={cn(box, 'rounded-panel border border-line object-cover transition hover:brightness-95')}
              />
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.s3_key}
              src={photo.url}
              alt={t('Photo')}
              loading="lazy"
              className={cn(box, 'rounded-panel border border-line object-cover')}
            />
          )
        ) : (
          <span
            key={photo.s3_key}
            className={cn(box, 'grid place-items-center rounded-panel border border-line bg-neutral-bg text-ink-faint')}
            title={t('Not available')}
          >
            <ImageOff className="size-4" />
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Before and after, side by side: the whole argument for closing a snag is that the second
 * picture shows the first one's problem gone.
 */
export function BeforeAfter({
  photos,
  size = 'md',
}: {
  photos: Array<QualityPhoto & { stage: SnagPhotoStage }>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { t } = useLanguage();
  const before = photos.filter((photo) => photo.stage === 'before');
  const after = photos.filter((photo) => photo.stage === 'after');
  if (photos.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {(
        [
          ['Before', before],
          ['After', after],
        ] as const
      ).map(([label, list]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t(label)}
          </span>
          {list.length > 0 ? (
            <PhotoStrip photos={list} size={size} />
          ) : (
            <span className="text-[12.5px] text-ink-faint">{t('No photo yet')}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A red box for the API's refusal, the same one every form in the app uses. */
export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}
