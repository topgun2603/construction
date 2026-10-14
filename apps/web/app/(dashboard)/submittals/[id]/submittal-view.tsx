'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Paperclip, RotateCcw, Send, Stamp, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  SUBMITTAL_OUTCOMES,
  SUBMITTAL_RESUBMITTABLE,
  SUBMITTAL_STATUS_LABELS,
  type SubmittalOutcome,
} from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { SiteDocument } from '@/lib/api-types';
import {
  addSubmittalFiles,
  deleteSubmittal,
  removeSubmittalFile,
  resubmitSubmittal,
  reviewSubmittal,
  revokeSubmittalLinks,
  startSubmittalReview,
  submitSubmittal,
  submittalLink,
} from '@/lib/rfi-actions';
import type { SubmittalDetail, SubmittalRevision } from '@/lib/rfi-types';
import { OptionSelect } from '../../safety/site-picker';
import { DocumentPicker } from '../../rfis/document-picker';
import { uploadRfiFiles } from '../../rfis/file-upload';
import { submittalBadge } from '../../rfis/labels';
import { ShareLink } from '../../rfis/share-link';
import { FileList } from '../../rfis/[id]/rfi-view';

/**
 * The interactive half of a submittal's page: the current revision's files and workflow, then every
 * revision with what was sent and what came back.
 */
export function SubmittalView({
  submittal,
  documents,
  canManage,
  canReview,
}: {
  submittal: SubmittalDetail;
  documents: SiteDocument[];
  canManage: boolean;
  canReview: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = submittal.revisions.find((revision) => revision.revision === submittal.current_revision)!;
  const inReview = current.status === 'submitted' || current.status === 'under_review';

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
      <div className="flex flex-wrap items-center gap-2">
        {canManage && current.status === 'draft' && (
          <SubmitDialog submittal={submittal} disabled={current.files.length === 0} />
        )}
        {canManage && inReview && submittal.reviewer.kind === 'external' && (
          <ShareLink
            label={t('Send to the reviewer')}
            sentAt={current.link_sent_at}
            mint={() => submittalLink(submittal.id)}
            revoke={() => revokeSubmittalLinks(submittal.id)}
          />
        )}
        {inReview && submittal.reviewer.kind === 'client' && (
          <span className="text-[13px] text-ink-muted">{t('Waiting on the client’s approval in their portal.')}</span>
        )}
        {canReview && current.status === 'submitted' && submittal.reviewer.kind === 'external' && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => startSubmittalReview(submittal.id), t('Marked as under review'))}
          >
            {t('Mark under review')}
          </Button>
        )}
        {canReview && inReview && submittal.reviewer.kind === 'external' && <ReviewDialog submittal={submittal} />}
        {canManage && (SUBMITTAL_RESUBMITTABLE as readonly string[]).includes(current.status) && (
          <ResubmitDialog submittal={submittal} />
        )}
        {canManage && submittal.current_revision === 0 && current.status === 'draft' && !current.submitted_at && (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost">
                {t('Delete draft')}
              </Button>
            }
            title={t('Delete this draft?')}
            body={`${submittal.label}: ${submittal.title}`}
            onConfirm={async () => {
              const result = await deleteSubmittal(submittal.id);
              if (result.ok) router.push('/submittals');
              return result;
            }}
          />
        )}
      </div>

      {canManage && current.status === 'draft' && (
        <DraftFiles submittal={submittal} revision={current} documents={documents} />
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-[14px] font-semibold">{t('Revisions')}</h3>
        {submittal.revisions.map((revision) => (
          <RevisionCard key={revision.id} revision={revision} reviewerKind={submittal.reviewer.kind} />
        ))}
      </section>
    </div>
  );
}

function RevisionCard({ revision, reviewerKind }: { revision: SubmittalRevision; reviewerKind: string }) {
  const { t } = useLanguage();
  const { shortDate, instantDate } = useFormat();
  const badge = submittalBadge(revision);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-semibold" dir="ltr">
          {t('Rev')} {revision.revision}
        </span>
        <Badge tone={badge.tone}>{t(badge.label)}</Badge>
        <span className="text-[12.5px] text-ink-muted">
          {revision.submitted_at
            ? `${t('Sent')} ${instantDate(revision.submitted_at)}${revision.submitted_by ? ` · ${revision.submitted_by.name}` : ''}`
            : t('Not sent yet')}
          {revision.due_on ? ` · ${t('due')} ${shortDate(revision.due_on)}` : ''}
        </span>
      </div>
      {revision.note && <p className="whitespace-pre-line text-[13px]">{revision.note}</p>}
      <FileList files={revision.files} />
      {revision.reviewed_at && (
        <div className="flex flex-col gap-1.5 rounded-btn border border-line bg-raised p-3 text-[13px]">
          <span className="font-semibold">
            {t(SUBMITTAL_STATUS_LABELS[revision.status])} · {revision.reviewer_name ?? (reviewerKind === 'client' ? t('Client') : '—')} ·{' '}
            {instantDate(revision.reviewed_at)}
          </span>
          {revision.review_comments && <p className="whitespace-pre-line">{revision.review_comments}</p>}
          {revision.markups.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-muted">{t('Marked-up copies')}</span>
              <FileList files={revision.markups} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function DraftFiles({
  submittal,
  revision,
  documents,
}: {
  submittal: SubmittalDetail;
  revision: SubmittalRevision;
  documents: SiteDocument[];
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setError(null);
    if (documentIds.length === 0 && files.length === 0) return setError(t('Choose a document or a file'));
    start(async () => {
      const uploaded = await uploadRfiFiles(files, submittal.project.id);
      if (!uploaded.ok) return setError(uploaded.error);
      const result = await addSubmittalFiles(submittal.id, [
        ...documentIds.map((document_id) => ({ document_id })),
        ...uploaded.files,
      ]);
      if (!result.ok) return setError(result.error ?? t('Could not add them'));
      setDocumentIds([]);
      setFiles([]);
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-[14px] font-semibold">
        {t('Files for')} {revision.label}
      </h3>
      {revision.files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {revision.files.map((file) => (
            <li
              key={file.id}
              className="inline-flex items-center gap-1.5 rounded-btn border border-line px-2 py-1 text-[12.5px]"
            >
              {file.filename}
              <button
                type="button"
                aria-label={t('Remove')}
                className="text-ink-faint hover:text-blocked-fg"
                onClick={() =>
                  start(async () => {
                    const result = await removeSubmittalFile(submittal.id, file.id);
                    if (!result.ok) toast.error(result.error ?? t('That did not work'));
                    router.refresh();
                  })
                }
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <DocumentPicker documents={documents} projectId={submittal.project.id} value={documentIds} onChange={setDocumentIds} />
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
        <Paperclip className="size-4" />
        {files.length > 0 ? files.map((file) => file.name).join(', ') : t('Upload photos or PDFs')}
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      {error && <p className="text-[13px] text-blocked-fg">{t(error)}</p>}
      <div>
        <Button size="sm" variant="secondary" onClick={add} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t('Add files')}
        </Button>
      </div>
    </Card>
  );
}

function SubmitDialog({ submittal, disabled }: { submittal: SubmittalDetail; disabled: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    const due = String(formData.get('due_on') ?? '').trim();
    const note = String(formData.get('note') ?? '').trim();
    setError(null);
    start(async () => {
      const result = await submitSubmittal(submittal.id, { ...(due ? { due_on: due } : {}), note: note || null });
      if (!result.ok) return setError(result.error ?? t('Could not send it'));
      toast.success(t('Submitted for review'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled} title={disabled ? t('Add the files first') : undefined}>
          <Send className="size-4" />
          {t('Submit for review')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('Submit')} {submittal.label}
          </DialogTitle>
          <DialogDescription>
            {submittal.reviewer.kind === 'client'
              ? t('The client gets it in their approvals.')
              : t('Then send the reviewer their link.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Review due')} htmlFor="sub-due" optional hint={t('Defaults from company settings')}>
            <Input id="sub-due" name="due_on" type="date" />
          </Field>
          <Field label={t('Cover note')} htmlFor="sub-note" optional>
            <Textarea id="sub-note" name="note" rows={3} maxLength={2000} />
          </Field>
          {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ submittal }: { submittal: SubmittalDetail }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<SubmittalOutcome>('approved');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    const comments = String(formData.get('comments') ?? '').trim();
    const reviewer = String(formData.get('reviewer_name') ?? '').trim();
    setError(null);
    start(async () => {
      const uploaded = await uploadRfiFiles(files, submittal.project.id);
      if (!uploaded.ok) return setError(uploaded.error);
      const result = await reviewSubmittal(submittal.id, {
        outcome,
        comments: comments || null,
        reviewer_name: reviewer || null,
        markups: uploaded.files,
      });
      if (!result.ok) return setError(result.error ?? t('Could not save it'));
      toast.success(t(SUBMITTAL_STATUS_LABELS[outcome]));
      setOpen(false);
      setFiles([]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Stamp className="size-4" />
          {t('Record the review')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Record the review')}</DialogTitle>
          <DialogDescription>{t('For a review that came back by email or by hand.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <OptionSelect
            label={t('Outcome')}
            value={outcome}
            onChange={(value) => setOutcome(value as SubmittalOutcome)}
            options={SUBMITTAL_OUTCOMES.map((value) => ({ value, label: SUBMITTAL_STATUS_LABELS[value] }))}
          />
          <Field label={t('Reviewed by')} htmlFor="rev-name" optional>
            <Input
              id="rev-name"
              name="reviewer_name"
              maxLength={120}
              defaultValue={submittal.reviewer.name ?? ''}
            />
          </Field>
          <Field label={t('Comments')} htmlFor="rev-comments" optional>
            <Textarea id="rev-comments" name="comments" rows={3} maxLength={8000} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
            <Paperclip className="size-4" />
            {files.length > 0 ? files.map((file) => file.name).join(', ') : t('Attach the marked-up copy')}
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          {error && <p className="text-[13px] text-blocked-fg">{t(error)}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save review')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResubmitDialog({ submittal }: { submittal: SubmittalDetail }) {
  const { t } = useLanguage();
  const [copy, setCopy] = useState(true);
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm">
          <RotateCcw className="size-4" />
          {t('Start the next revision')}
        </Button>
      }
      title={`${t('Start Rev')} ${submittal.current_revision + 1}?`}
      body={
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={copy} onChange={(event) => setCopy(event.target.checked)} />
          {t('Start with the same files, to replace the ones that changed')}
        </label>
      }
      confirmLabel={t('Start revision')}
      onConfirm={() => resubmitSubmittal(submittal.id, copy)}
      successMessage={t('New revision started')}
    />
  );
}
