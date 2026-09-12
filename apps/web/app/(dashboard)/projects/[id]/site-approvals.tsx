'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, ClipboardCheck, FileText, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createApproval, decideApproval, deleteApproval } from '@/lib/actions';
import type { Approval, SiteDocument } from '@/lib/api-types';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { relativeTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS: Record<Approval['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'pending' },
  approved: { label: 'Approved', tone: 'done' },
  rejected: { label: 'Rejected', tone: 'blocked' },
};

/**
 * Things the client has been asked to sign off.
 *
 * The decision names whoever gave it, and that name is on screen next to their role — because an
 * owner may hold `approvals.decide` and record what a client said on the phone, which is how sites
 * actually work. What must never happen is that reading back as the client having clicked it
 * themselves, so the row says "Approved by Gowtham Kumar (Owner)" and means exactly that.
 *
 * A decision is final: there is no undo here because there is none in the API. An approval somebody
 * can quietly revise is evidence of nothing, and evidence is the only reason this exists.
 */
export function SiteApprovals({
  projectId,
  approvals,
  sharedDocuments,
  canRequest,
  canDecide,
}: {
  projectId: string;
  approvals: Approval[];
  /** Only documents the client can already open may be attached. */
  sharedDocuments: SiteDocument[];
  canRequest: boolean;
  canDecide: boolean;
}) {
  const waiting = approvals.filter((approval) => approval.status === 'pending');
  const settled = approvals.filter((approval) => approval.status !== 'pending');

  return (
    <div className="flex flex-col gap-4">
      {canRequest && (
        <div className="flex justify-end">
          <RequestDialog projectId={projectId} documents={sharedDocuments} />
        </div>
      )}

      {approvals.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck />}
          title="Nothing waiting to be signed off"
          body={
            canRequest
              ? 'Ask the client to approve a drawing, a selection or a variation, and their answer stays on the job with their name on it.'
              : 'Anything your builder needs you to approve will appear here.'
          }
        />
      )}

      {waiting.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Waiting on an answer
          </h3>
          <Card className="divide-y divide-line-soft">
            {waiting.map((approval) => (
              <Row
                key={approval.id}
                approval={approval}
                canDecide={canDecide}
                canRequest={canRequest}
              />
            ))}
          </Card>
        </div>
      )}

      {settled.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Decided
          </h3>
          <Card className="divide-y divide-line-soft">
            {settled.map((approval) => (
              <Row key={approval.id} approval={approval} canDecide={false} canRequest={false} />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({
  approval,
  canDecide,
  canRequest,
}: {
  approval: Approval;
  canDecide: boolean;
  canRequest: boolean;
}) {
  const status = STATUS[approval.status];

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium">{approval.title}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <span className="text-[12.5px] text-ink-muted" suppressHydrationWarning>
            Asked by {approval.requested_by.name} · {relativeTime(approval.created_at)}
          </span>
        </div>

        {approval.status === 'pending' && (canDecide || canRequest) && (
          <div className="flex flex-none items-center gap-2">
            {canDecide && <DecideButtons approval={approval} />}
            {canRequest && !canDecide && (
              <ConfirmDialog
                title="Withdraw this request?"
                body={
                  <>
                    <strong className="font-semibold text-ink">{approval.title}</strong> comes off
                    the list. Nobody has answered it yet, so nothing is lost.
                  </>
                }
                confirmLabel="Withdraw"
                successMessage="Withdrawn"
                onConfirm={() => deleteApproval(approval.id, approval.project_id)}
                trigger={
                  <Button size="icon" variant="ghost" aria-label="Withdraw">
                    <Trash2 className="size-4" />
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>

      {approval.body && (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-soft">
          {approval.body}
        </p>
      )}

      {approval.document?.url && (
        <a
          href={approval.document.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex max-w-[280px] items-center gap-2.5 rounded-btn border border-line bg-surface px-3 py-2 transition hover:border-accent"
        >
          <FileText className="size-5 flex-none text-ink-faint" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium">{approval.document.title}</span>
            <span className="text-[11.5px] text-ink-muted">rev {approval.document.version}</span>
          </span>
        </a>
      )}

      {approval.decided_by && (
        <div
          className={cn(
            'rounded-btn px-3 py-2 text-[13px]',
            approval.status === 'approved' ? 'bg-done-bg text-done-fg' : 'bg-blocked-bg text-blocked-fg',
          )}
        >
          {/*
            The role is here on purpose. "Approved by Gowtham Kumar (Owner)" is a different fact
            from the client having clicked it, and the record should never blur the two.
          */}
          <span className="font-semibold">
            {status.label} by {approval.decided_by.name} ({titleCase(approval.decided_by.role)})
          </span>
          <span suppressHydrationWarning> · {relativeTime(approval.decided_at ?? '')}</span>
          {approval.decision_note && <p className="mt-1">{approval.decision_note}</p>}
        </div>
      )}
    </div>
  );
}

function DecideButtons({ approval }: { approval: Approval }) {
  const router = useRouter();
  const [open, setOpen] = useState<'approved' | 'rejected' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!open) return;
    setError(null);
    start(async () => {
      const result = await decideApproval({
        id: approval.id,
        projectId: approval.project_id,
        status: open,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (!result.ok) return setError(result.error ?? 'Could not record that');
      toast.success(open === 'approved' ? 'Approved' : 'Rejected');
      setOpen(null);
      setNote('');
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen('rejected')}>
        <X className="size-4" /> Reject
      </Button>
      <Button size="sm" onClick={() => setOpen('approved')}>
        <Check className="size-4" /> Approve
      </Button>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open === 'approved' ? 'Approve' : 'Reject'} — {approval.title}
            </DialogTitle>
            <DialogDescription>
              This is recorded against your name and cannot be changed afterwards. That is what
              makes it worth anything if it is ever questioned.
            </DialogDescription>
          </DialogHeader>
          <Field label="Anything to add" optional htmlFor="decision-note">
            <Textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={open === 'approved' ? 'Yes, the darker one.' : 'Why not?'}
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {open === 'approved' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RequestDialog({
  projectId,
  documents,
}: {
  projectId: string;
  documents: SiteDocument[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [documentId, setDocumentId] = useState('none');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!title.trim()) return setError('Say what you need them to decide');
    setError(null);
    start(async () => {
      const result = await createApproval({
        projectId,
        title: title.trim(),
        body: body.trim(),
        document_id: documentId === 'none' ? null : documentId,
      });
      if (!result.ok) return setError(result.error ?? 'Could not ask that');
      setOpen(false);
      setTitle('');
      setBody('');
      setDocumentId('none');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Ask for approval
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask the client to approve something</DialogTitle>
          <DialogDescription>
            Their answer stays on the job with their name and the date on it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="What are they deciding" htmlFor="approval-title">
            <Input
              id="approval-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="Bathroom tile — the darker one?"
            />
          </Field>
          <Field label="Anything they need to know" optional htmlFor="approval-body">
            <Textarea
              id="approval-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Sample is up on the second floor."
            />
          </Field>
          <Field
            label="Drawing or document"
            hint={
              documents.length === 0
                ? 'Only documents already shared with the client can be attached.'
                : 'Only documents the client can already open are listed.'
            }
          >
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nothing attached</SelectItem>
                {documents.map((document) => (
                  <SelectItem key={document.id} value={document.id}>
                    {document.title} (rev {document.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Ask
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
