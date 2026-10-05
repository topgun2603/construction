'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/components/language-provider';
import { attachSafetyPhoto } from '@/lib/safety-actions';
import type { SafetyPhoto } from '@/lib/safety-types';
import { uploadSafetyPhoto } from './photo-upload';

const PURPOSE: Record<SafetyPhoto['purpose'], string> = {
  evidence: 'Evidence',
  witness_statement: 'Witness statement',
  closeout: 'Close-out',
  attendance: 'Attendance',
};

/** A record's photos, and a button to add one — the scene, a signed witness statement, the fix. */
export function PhotoStrip({
  photos,
  projectId,
  parent,
  canAdd,
  purposes = ['evidence'],
}: {
  photos: SafetyPhoto[];
  projectId: string;
  parent: { incident_id?: string; observation_id?: string; permit_id?: string; toolbox_talk_id?: string };
  canAdd: boolean;
  purposes?: Array<SafetyPhoto['purpose']>;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [purpose, setPurpose] = useState<SafetyPhoto['purpose']>(purposes[0] ?? 'evidence');
  const [pending, start] = useTransition();

  function add(file: File | undefined) {
    if (!file) return;
    start(async () => {
      const uploaded = await uploadSafetyPhoto(file, projectId);
      if (!uploaded.ok) return void toast.error(t(uploaded.error));
      const result = await attachSafetyPhoto({ ...parent, s3_key: uploaded.key, purpose });
      if (!result.ok) return void toast.error(result.error ?? t('Could not attach the photo'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <figure key={photo.id} className="flex flex-col gap-1">
              {photo.url ? (
                <a href={photo.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL */}
                  <img src={photo.url} alt={photo.caption ?? t(PURPOSE[photo.purpose])} className="aspect-square w-full rounded-btn object-cover" />
                </a>
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-btn bg-raised text-ink-faint">
                  <Camera className="size-5" />
                </div>
              )}
              <figcaption className="text-[11.5px] text-ink-muted">{t(PURPOSE[photo.purpose])}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {canAdd && (
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          {purposes.length > 1 && (
            <select
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as SafetyPhoto['purpose'])}
              className="h-9 rounded-btn border border-line bg-surface px-2 text-[13px]"
            >
              {purposes.map((value) => (
                <option key={value} value={value}>
                  {t(PURPOSE[value])}
                </option>
              ))}
            </select>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-accent">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {t('Add photo')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={pending}
              onChange={(event) => add(event.target.files?.[0])}
            />
          </label>
        </div>
      )}
    </div>
  );
}
