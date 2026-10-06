'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileDiff, FileText, Loader2, Paperclip, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import {
  closeRfi,
  deleteRfi,
  markRfiOfficial,
  openRfi,
  raiseChangeOrderFromRfi,
  reopenRfi,
  respondToRfi,
  revokeRfiLinks,
  rfiLink,
  voidRfi,
} from '@/lib/rfi-actions';
import type { SiteDocument } from '@/lib/api-types';
import type { RfiDetail, RfiFile } from '@/lib/rfi-types';
import { uploadRfiFiles } from '../file-upload';
import { ShareLink } from '../share-link';
import { RfiEditDialog } from './rfi-edit-dialog';

/** Files as links that open in a new tab, signed for an hour by the API. */
export function FileList({ files }: { files: RfiFile[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.id}>
          <a
            href={file.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-btn border border-line px-2 py-1 text-[12.5px] hover:bg-raised"
          >
            {file.document ? <FileText className="size-3.5" /> : <Paperclip className="size-3.5" />}
            {file.filename}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The interactive half of an RFI's page: sending it, the thread, answering, the official answer, and
 * the workflow buttons. What the RFI says is drawn by the server page above this.
 */
export function RfiView({
  rfi,
  canManage,
  canRaiseChangeOrder,
  people,
  documents,
}: {
  rfi: RfiDetail;
  canManage: boolean;
  canRaiseChangeOrder: boolean;
  people: Array<{ id: string; name: string }>;
  documents: SiteDocument[];
}) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const live = rfi.status === 'open' || rfi.status === 'answered';

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    start(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? t('That did not work'));
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {(rfi.status === 'draft' || live) && (
            <ShareLink
              label={rfi.status === 'draft' ? t('Send to the designer') : t('Send the link again')}
              sentAt={rfi.link_sent_at}
              mint={() => rfiLink(rfi.id)}
              revoke={() => revokeRfiLinks(rfi.id)}
            />
          )}
          {rfi.status === 'draft' && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => openRfi(rfi.id), t('Opened'))}>
              {t('Open without sending')}
            </Button>
          )}
          {rfi.status === 'answered' && (
            <CloseRfi id={rfi.id} />
          )}
          {rfi.status === 'answered' && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reopenRfi(rfi.id), t('Back to open'))}>
              {t('Not answered — reopen')}
            </Button>
          )}
          {canRaiseChangeOrder && rfi.status !== 'void' && (!rfi.change_order || rfi.change_order.status === 'cancelled') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await raiseChangeOrderFromRfi(rfi.id);
                  if (!result.ok || !result.data) {
                    toast.error(result.error ?? t('That did not work'));
                    return;
                  }
                  toast.success(`${result.data.change_order.label} ${t('raised as a draft')}`);
                  router.push(`/change-orders/${result.data.change_order.id}`);
                })
              }
            >
              <FileDiff className="size-4" />
              {t('Raise a change order')}
            </Button>
          )}
          {rfi.status !== 'closed' && rfi.status !== 'void' && (
            <RfiEditDialog rfi={rfi} people={people} documents={documents} />
          )}
          {rfi.status !== 'closed' && rfi.status !== 'void' && <VoidRfi id={rfi.id} />}
          {rfi.status === 'draft' && !rfi.sent_at && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost">
                  {t('Delete draft')}
                </Button>
              }
              title={t('Delete this draft?')}
              body={`${rfi.label}: ${rfi.subject}`}
              onConfirm={async () => {
                const result = await deleteRfi(rfi.id);
                if (result.ok) router.push('/rfis');
                return result;
              }}
            />
          )}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-[14px] font-semibold">
          {t('Answers')} <span className="font-normal text-ink-muted">({rfi.responses.length})</span>
        </h3>
        {rfi.responses.length === 0 && (
          <p className="text-[13px] text-ink-muted">
            {rfi.status === 'draft' ? t('Not sent yet.') : t('Waiting on the designer.')}
          </p>
        )}
        {rfi.responses.map((response) => (
          <Card
            key={response.id}
            className={response.is_official ? 'flex flex-col gap-2 border-done p-4' : 'flex flex-col gap-2 p-4'}
          >
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
              <span className="font-semibold text-ink">{response.author.name}</span>
              {response.external && <Badge dot={false}>{t('Through their link')}</Badge>}
              {response.is_official && (
                <Badge tone="done">
                  <CheckCircle2 className="size-3" /> {t('Official answer')}
                </Badge>
              )}
              <span>
                {instantDate(response.created_at)}, {timeOfDay(response.created_at)}
              </span>
              {canManage && live && !response.is_official && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto"
                  disabled={pending}
                  onClick={() => run(() => markRfiOfficial(rfi.id, response.id), t('Marked as the official answer'))}
                >
                  <Star className="size-3.5" />
                  {t('Make official')}
                </Button>
              )}
            </div>
            <p className="whitespace-pre-line text-[14px]">{response.body}</p>
            <FileList files={response.attachments} />
          </Card>
        ))}
        {canManage && live && <RespondForm rfi={rfi} />}
      </section>
    </div>
  );
}

function RespondForm({ rfi }: { rfi: RfiDetail }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const body = String(data.get('body') ?? '').trim();
    const onBehalf = String(data.get('on_behalf_of') ?? '').trim();
    if (!body) return setError(t('Write the reply first'));
    setError(null);
    start(async () => {
      const uploaded = await uploadRfiFiles(files, rfi.project.id);
      if (!uploaded.ok) return setError(uploaded.error);
      const result = await respondToRfi(rfi.id, {
        body,
        official: data.get('official') === 'on',
        ...(onBehalf ? { on_behalf_of: onBehalf } : {}),
        attachments: uploaded.files,
      });
      if (!result.ok) return setError(result.error ?? t('Could not save it'));
      form.reset();
      setFiles([]);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <Field label={t('Reply, or record an answer that came by email or phone')} htmlFor="rfi-reply">
        <Textarea id="rfi-reply" name="body" rows={3} maxLength={8000} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Answer given by')} htmlFor="rfi-behalf" optional hint={t('When recording somebody else’s answer')}>
          <Input id="rfi-behalf" name="on_behalf_of" maxLength={120} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="official" />
            {t('This is the official answer')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
            <Paperclip className="size-4" />
            {files.length > 0 ? files.map((file) => file.name).join(', ') : t('Attach photos or PDFs')}
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
        </div>
      </div>
      {error && <p className="text-[13px] text-blocked-fg">{t(error)}</p>}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t('Post')}
        </Button>
      </div>
    </form>
  );
}

function CloseRfi({ id }: { id: string }) {
  const { t } = useLanguage();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm">
          <CheckCircle2 className="size-4" />
          {t('Close RFI')}
        </Button>
      }
      title={t('Close this RFI on its official answer?')}
      body={t('A closed RFI is the record of what was asked and answered, and cannot be changed.')}
      confirmLabel={t('Close RFI')}
      onConfirm={() => closeRfi(id)}
      successMessage={t('Closed')}
    />
  );
}

function VoidRfi({ id }: { id: string }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost">
          {t('Void')}
        </Button>
      }
      title={t('Void this RFI?')}
      body={
        <div className="flex flex-col gap-2">
          <span>{t('It stays on the log, marked void, and its links stop working.')}</span>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('Why it is no longer needed')}
            aria-label={t('Why it is no longer needed')}
          />
        </div>
      }
      confirmLabel={t('Void')}
      onConfirm={() => voidRfi(id, reason.trim() || 'No longer needed')}
      successMessage={t('Voided')}
    />
  );
}

/** A link to the change order raised from the RFI, for the facts panel. */
export function ChangeOrderLink({ changeOrder }: { changeOrder: RfiDetail['change_order'] }) {
  if (!changeOrder) return <>—</>;
  return (
    <Link href={`/change-orders/${changeOrder.id}`} className="font-mono text-accent hover:underline" dir="ltr">
      {changeOrder.label}
    </Link>
  );
}
