'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { viewUrl } from '@/lib/actions';
import type { DailyReport } from '@/lib/api-types';

/**
 * The photographs attached to one day's report.
 *
 * URLs are signed after mount rather than server-rendered with the page: a signed URL has a
 * lifetime, and baking one into the HTML means a page restored from the browser's back-forward
 * cache shows broken images.
 */
export function ReportPhotos({ photos }: { photos: DailyReport['photos'] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((photo) => (
        <Thumb key={photo.id} s3Key={photo.thumb_s3_key ?? photo.s3_key} caption={photo.caption} />
      ))}
    </div>
  );
}

function Thumb({ s3Key, caption }: { s3Key: string; caption: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void viewUrl(s3Key).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setUrl(result.data.url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [s3Key]);

  if (failed) {
    return (
      <span className="grid size-[92px] place-items-center rounded-panel border border-line bg-neutral-bg text-[11px] text-ink-faint">
        Not available
      </span>
    );
  }

  if (!url) {
    return (
      <span className="grid size-[92px] place-items-center rounded-panel border border-line bg-neutral-bg">
        <Loader2 className="size-4 animate-spin text-ink-faint" />
      </span>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer noopener" title={caption ?? 'Report photo'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={caption ?? 'Report photo'}
        loading="lazy"
        className="size-[92px] rounded-panel border border-line object-cover transition hover:brightness-95"
      />
    </a>
  );
}
