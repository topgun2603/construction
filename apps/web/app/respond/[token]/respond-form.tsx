'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Paperclip } from 'lucide-react';
import { MAX_UPLOAD_BYTES, SUBMITTAL_OUTCOMES, SUBMITTAL_STATUS_LABELS, type SubmittalOutcome } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';
import { answerRfiByLink, presignResponderUpload, reviewSubmittalByLink } from '@/lib/respond-actions';

/**
 * The answer, from somebody with no account: their name, their reply (or their review outcome), and
 * any files. Uploads go through a presign that only accepts this link's record, so a file can never
 * land anywhere else in the builder's storage.
 */
export function RespondForm({
  token,
  kind,
  defaultName,
}: {
  token: string;
  kind: 'rfi' | 'submittal';
  defaultName: string | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [outcome, setOutcome] = useState<SubmittalOutcome>('approved');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  async function upload(): Promise<
    { ok: true; files: Array<{ s3_key: string; content_type: string; filename: string }> } | { ok: false; error: string }
  > {
    const out: Array<{ s3_key: string; content_type: string; filename: string }> = [];
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES.image) return { ok: false, error: `${file.name}: ${t('That file is too large')}` };
      const presigned = await presignResponderUpload({
        token,
        content_type: file.type || 'application/octet-stream',
        content_length: file.size,
        filename: file.name.slice(0, 200),
      });
      if (!presigned.ok || !presigned.data) return { ok: false, error: presigned.error ?? t('Could not upload that file') };
      const put = await fetch(presigned.data.url, { method: 'PUT', headers: presigned.data.headers, body: file });
      if (!put.ok) return { ok: false, error: `${file.name}: ${t('The file did not upload. Try again.')}` };
      out.push({ s3_key: presigned.data.s3_key, content_type: file.type, filename: file.name.slice(0, 200) });
    }
    return { ok: true, files: out };
  }

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const body = String(data.get('body') ?? '').trim();
    if (!name) return setError(t('Please give your name'));
    if (kind === 'rfi' && !body) return setError(t('Please write your answer'));
    setError(null);
    start(async () => {
      const uploaded = await upload();
      if (!uploaded.ok) return setError(uploaded.error);
      const result =
        kind === 'rfi'
          ? await answerRfiByLink({ token, name, email, body, attachments: uploaded.files })
          : await reviewSubmittalByLink({
              token,
              name,
              email,
              outcome,
              comments: body || null,
              markups: uploaded.files,
            });
      if (!result.ok) return setError(result.error ?? t('Could not send it'));
      setDone(true);
      setFiles([]);
      form.reset();
      router.refresh();
    });
  }

  if (done && kind === 'submittal') {
    return <p className="rounded-panel border border-line bg-raised p-4 text-[14px]">{t('Your review has been sent. Thank you.')}</p>;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5"
    >
      <h2 className="text-[16px] font-semibold">{kind === 'rfi' ? t('Your answer') : t('Your review')}</h2>
      {done && <p className="text-[13.5px] text-done-fg">{t('Sent. You can add more below if needed.')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold">
          {t('Your name')}
          <Input name="name" maxLength={120} defaultValue={defaultName ?? ''} autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold">
          {t('Email (optional)')}
          <Input name="email" type="email" maxLength={200} autoComplete="email" dir="ltr" />
        </label>
      </div>
      {kind === 'submittal' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13.5px] font-semibold">{t('Outcome')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUBMITTAL_OUTCOMES.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded-btn border border-line px-3 py-2 text-[14px] has-[:checked]:border-accent"
              >
                <input
                  type="radio"
                  name="outcome"
                  value={value}
                  checked={outcome === value}
                  onChange={() => setOutcome(value)}
                />
                {t(SUBMITTAL_STATUS_LABELS[value])}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold">
        {kind === 'rfi' ? t('Answer') : t('Comments')}
        <Textarea name="body" rows={6} maxLength={8000} />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-muted">
        <Paperclip className="size-4" />
        {files.length > 0
          ? files.map((file) => file.name).join(', ')
          : kind === 'rfi'
            ? t('Attach sketches, photos or PDFs')
            : t('Attach the marked-up copy')}
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      {error && <p className="text-[13.5px] text-blocked-fg">{error}</p>}
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {kind === 'rfi' ? t('Send answer') : t('Send review')}
        </Button>
      </div>
    </form>
  );
}
