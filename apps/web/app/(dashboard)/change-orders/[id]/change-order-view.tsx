'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Paperclip, Pencil, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { basisPointsToPercent, taxRule } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { SiteDocument } from '@/lib/api-types';
import { titleCase } from '@/lib/format';
import {
  approveChangeOrder,
  attachChangeOrderDocument,
  cancelChangeOrder,
  deleteChangeOrder,
  implementChangeOrder,
  recordClientDecision,
  removeChangeOrderAttachment,
  returnChangeOrder,
  reviseChangeOrder,
  submitChangeOrder,
} from '@/lib/change-order-actions';
import type { ChangeOrderDetail } from '@/lib/change-order-types';
import type { ActionResult } from '@/lib/server-api';
import { ChangeOrderDialog } from '../change-order-dialog';
import { changeOrderDaysText } from '../labels';

export interface ChangeOrderAbilities {
  manage: boolean;
  approve: boolean;
  /** `approvals.decide` — recording the client's answer, usually one taken over the phone. */
  decide: boolean;
  /** The caller submitted it, and is not an owner: somebody else has to approve it. */
  ownSubmission: boolean;
}

/**
 * One change order: what it is, what it costs and charges, where it is in the workflow, and — once
 * the client said yes — exactly what it moved. Every control appears only for whoever the API
 * would let use it.
 */
export function ChangeOrderView({
  changeOrder,
  documents,
  can,
}: {
  changeOrder: ChangeOrderDetail;
  documents: SiteDocument[];
  can: ChangeOrderAbilities;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const { money, shortDate } = format;
  const rule = taxRule(format.settings.taxRegime ?? 'none');
  const co = changeOrder;

  return (
    <div className="flex flex-col gap-4">
      <ActionsBar changeOrder={co} can={can} />

      {co.review_note && co.status === 'draft' && (
        <p className="rounded-btn bg-pending-bg px-3 py-2 text-[13.5px] text-pending-fg">
          {t('Returned')}: {co.review_note}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Figures')}</span>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Stat label={t('Cost impact')} value={money(co.cost_impact)} />
            <Stat
              label={co.entered_price ? t('Agreed price') : `${t('Price')} (${t('markup')} ${basisPointsToPercent(co.markup_bp)}%)`}
              value={money(co.client_price)}
            />
            <Stat label={t('Margin')} value={money(co.margin)} />
            <Stat label={`${rule.taxName ?? t('Tax')} ${basisPointsToPercent(co.tax_rate_bp)}%`} value={money(co.tax)} />
            <Stat label={t('Client total')} value={money(co.client_total)} strong />
            <Stat label={t('Time impact')} value={changeOrderDaysText(co.time_impact_days, t)} />
          </dl>
          {co.description && <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-soft">{co.description}</p>}
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('History')}</span>
          <ol className="flex flex-col gap-2 text-[13px]">
            <Step label={t('Raised')} who={co.raised_by?.name} when={shortDate(co.raised_on)} />
            {co.submitted_at && <Step label={t('Submitted for approval')} who={co.submitted_by?.name} when={format.instantDate(co.submitted_at)} />}
            {co.approved_at && (
              <Step label={t('Approved and sent to the client')} who={co.approved_by?.name} when={format.instantDate(co.approved_at)} />
            )}
            {co.client_decided_by && co.client_decided_at && (
              <Step
                label={co.status === 'rejected' ? t('Rejected by the client') : t('Approved by the client')}
                who={`${co.client_decided_by.name} (${t(titleCase(co.client_decided_by.role))})`}
                when={format.instantDate(co.client_decided_at)}
                note={co.client_note}
              />
            )}
            {co.implemented_at && <Step label={t('Implemented')} who={co.implemented_by?.name} when={format.instantDate(co.implemented_at)} />}
            {co.cancelled_at && (
              <Step label={t('Cancelled')} who={co.cancelled_by?.name} when={format.instantDate(co.cancelled_at)} note={co.cancel_reason} />
            )}
          </ol>
          {co.revision > 0 && (
            <p className="text-[12px] text-ink-muted">
              {t('Revision')} {co.revision}. {t('Earlier revisions and the client’s answers to them stay in the site’s approvals.')}
            </p>
          )}
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Description')}</TableHead>
              <TableHead>{t('Cost code')}</TableHead>
              <TableHead className="text-end">{t('Qty')}</TableHead>
              <TableHead className="text-end">{t('Rate')}</TableHead>
              <TableHead className="text-end">{t('Cost')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {co.lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-ink-muted">
                  {t('No lines yet.')}
                </TableCell>
              </TableRow>
            )}
            {co.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.description}</TableCell>
                <TableCell className="text-ink-muted">
                  {line.cost_code ? `${line.cost_code.code} ${line.cost_code.name}` : '—'}
                </TableCell>
                <TableCell className="text-end font-mono">
                  {line.quantity ? `${line.quantity} ${line.unit ?? ''}` : t('Lump sum')}
                </TableCell>
                <TableCell className="text-end font-mono">{line.rate ? money(line.rate) : '—'}</TableCell>
                <TableCell className="text-end font-mono">{money(line.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {co.applied_at && <WhatItMoved changeOrder={co} />}

      <Attachments changeOrder={co} documents={documents} canEdit={can.manage && co.status === 'draft'} />
    </div>
  );
}

// --- the workflow's buttons ----------------------------------------------------------------------

function ActionsBar({ changeOrder, can }: { changeOrder: ChangeOrderDetail; can: ChangeOrderAbilities }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const co = changeOrder;

  function run(work: () => Promise<ActionResult>, done: string, then?: () => void) {
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? t('Could not do that'));
        return;
      }
      toast.success(done);
      if (then) then();
      else router.refresh();
    });
  }

  const canDelete = can.manage && co.status === 'draft' && co.revision === 0 && !co.submitted_at;
  const canCancel = can.manage && ['draft', 'submitted', 'sent', 'rejected'].includes(co.status);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pending && <Loader2 className="size-4 animate-spin text-ink-faint" />}
      <Button asChild variant="secondary" size="sm">
        <Link href={`/change-orders/${co.id}/print`}>
          <Printer className="size-4" />
          {t('Print')}
        </Link>
      </Button>
      {canDelete && (
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() =>
            run(() => deleteChangeOrder(co.id, co.project.id), t('Draft deleted'), () => router.push('/change-orders'))
          }
        >
          <Trash2 className="size-4" />
          {t('Delete draft')}
        </Button>
      )}
      {canCancel && !canDelete && (
        <NoteDialog
          title={`${t('Cancel')} ${co.label}?`}
          description={
            co.status === 'sent'
              ? t('The request waiting on the client is withdrawn with it.')
              : t('It stays on the register as cancelled.')
          }
          label={t('Why')}
          confirm={t('Cancel change order')}
          destructive
          onConfirm={(note) => cancelChangeOrder(co.id, note)}
          done={t('Change order cancelled')}
          trigger={
            <Button size="sm" variant="destructive" disabled={pending}>
              {t('Cancel change order')}
            </Button>
          }
        />
      )}
      {can.manage && co.status === 'draft' && (
        <>
          <ChangeOrderDialog
            sites={[co.project]}
            existing={co}
            trigger={
              <Button size="sm" variant="secondary">
                <Pencil className="size-4" />
                {t('Edit')}
              </Button>
            }
          />
          <Button size="sm" disabled={pending} onClick={() => run(() => submitChangeOrder(co.id), t('Submitted for approval'))}>
            {t('Submit for approval')}
          </Button>
        </>
      )}
      {can.approve && co.status === 'submitted' && (
        <>
          <NoteDialog
            title={`${t('Return')} ${co.label}?`}
            description={t('It goes back to draft with your note, for whoever raised it to fix.')}
            label={t('What needs changing')}
            confirm={t('Return to draft')}
            onConfirm={(note) => returnChangeOrder(co.id, note)}
            done={t('Returned to draft')}
            trigger={
              <Button size="sm" variant="secondary" disabled={pending}>
                {t('Return')}
              </Button>
            }
          />
          {can.ownSubmission ? (
            <span className="text-[12.5px] text-ink-muted">{t('Somebody else has to approve a change order you submitted.')}</span>
          ) : (
            <NoteDialog
              title={`${t('Approve')} ${co.label}?`}
              description={t('It goes to the client as an approval request, showing the price and the days — never the cost.')}
              label={t('Note')}
              confirm={t('Approve and send to client')}
              approve
              onConfirm={(note) => approveChangeOrder(co.id, note)}
              done={t('Sent to the client')}
              trigger={
                <Button size="sm" variant="approve" disabled={pending}>
                  {t('Approve and send to client')}
                </Button>
              }
            />
          )}
        </>
      )}
      {can.decide && co.status === 'sent' && <ClientDecisionDialog changeOrder={co} />}
      {can.manage && co.status === 'rejected' && (
        <Button size="sm" disabled={pending} onClick={() => run(() => reviseChangeOrder(co.id), t('Revision started'))}>
          {t('Revise')}
        </Button>
      )}
      {can.manage && co.status === 'approved' && (
        <Button size="sm" variant="approve" disabled={pending} onClick={() => run(() => implementChangeOrder(co.id), t('Marked implemented'))}>
          {t('Mark implemented')}
        </Button>
      )}
    </div>
  );
}

/** The client's answer taken over the phone, recorded in the recorder's own name. */
function ClientDecisionDialog({ changeOrder }: { changeOrder: ChangeOrderDetail }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<'approved' | 'rejected'>('approved');
  return (
    <NoteDialog
      title={t('Record the client’s decision')}
      description={t('Only for a decision the client gave you directly. It is recorded in your name, with your role — never as the client having clicked it.')}
      label={t('What the client said')}
      confirm={t('Record decision')}
      onConfirm={(note) => recordClientDecision(changeOrder.id, status, note)}
      done={t('Decision recorded')}
      extra={
        <Field label={t('Decision')}>
          <Select value={status} onValueChange={(value) => setStatus(value as 'approved' | 'rejected')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approved">{t('Approved')}</SelectItem>
              <SelectItem value="rejected">{t('Rejected')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      }
      trigger={
        <Button size="sm" variant="secondary">
          {t('Record client decision')}
        </Button>
      }
    />
  );
}

function NoteDialog({
  title,
  description,
  label,
  confirm,
  onConfirm,
  done,
  trigger,
  extra,
  approve = false,
  destructive = false,
}: {
  title: string;
  description: string;
  label: string;
  confirm: string;
  onConfirm: (note?: string) => Promise<ActionResult>;
  done: string;
  trigger: ReactNode;
  extra?: ReactNode;
  approve?: boolean;
  destructive?: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await onConfirm(note.trim() || undefined);
      if (!result.ok) {
        setError(result.error ?? t('Could not do that'));
        return;
      }
      toast.success(done);
      setOpen(false);
      setNote('');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {extra}
          <Field label={label} optional htmlFor="co-note">
            <Textarea id="co-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('Back')}
          </Button>
          <Button
            type="button"
            variant={approve ? 'approve' : destructive ? 'destructive' : 'primary'}
            disabled={pending}
            onClick={submit}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- what an approved change order moved ---------------------------------------------------------

function WhatItMoved({ changeOrder }: { changeOrder: ChangeOrderDetail }) {
  const { t } = useLanguage();
  const { money, shortDate } = useFormat();
  const site = changeOrder.site_revision;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {t('What the client’s approval changed')}
      </span>
      {site && (
        <dl className="grid gap-3 sm:grid-cols-3">
          <BeforeAfter
            label={t('Handover date')}
            before={site.handover_before ? shortDate(site.handover_before) : '—'}
            after={site.handover_after ? shortDate(site.handover_after) : '—'}
          />
          <BeforeAfter
            label={t('Contract value')}
            before={site.contract_before ? money(site.contract_before) : t('Not set')}
            after={site.contract_after ? money(site.contract_after) : t('Not set')}
          />
          <BeforeAfter
            label={t('Site budget')}
            before={site.site_budget_before ? money(site.site_budget_before) : t('Not set')}
            after={site.site_budget_after ? money(site.site_budget_after) : t('Not set')}
          />
        </dl>
      )}
      {changeOrder.budget_revisions.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Cost code')}</TableHead>
              <TableHead className="text-end">{t('Budget before')}</TableHead>
              <TableHead className="text-end">{t('Change')}</TableHead>
              <TableHead className="text-end">{t('Budget after')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changeOrder.budget_revisions.map((revision) => (
              <TableRow key={revision.id}>
                <TableCell>
                  {revision.cost_code.code} {revision.cost_code.name}
                </TableCell>
                <TableCell className="text-end font-mono">{money(revision.budget_before)}</TableCell>
                <TableCell className="text-end font-mono">
                  {money(revision.amount)}
                  {revision.amount !== revision.requested && (
                    <span className="block text-[11.5px] text-ink-muted">
                      {t('asked')} {money(revision.requested)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-end font-mono">{money(revision.budget_after)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// --- attachments ---------------------------------------------------------------------------------

function Attachments({
  changeOrder,
  documents,
  canEdit,
}: {
  changeOrder: ChangeOrderDetail;
  documents: SiteDocument[];
  canEdit: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState('');
  const attached = new Set(changeOrder.attachments.map((row) => row.document?.id).filter(Boolean));
  const available = documents.filter((document) => !attached.has(document.id));
  if (!canEdit && changeOrder.attachments.length === 0) return null;

  function run(work: () => Promise<ActionResult>) {
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? t('Could not do that'));
        return;
      }
      setChoice('');
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {t('Photos and documents')}
      </span>
      {changeOrder.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {changeOrder.attachments.map((attachment) => {
            const isImage = attachment.content_type?.startsWith('image/') && !attachment.document;
            return (
              <li key={attachment.id} className="flex items-center gap-1">
                <a
                  href={attachment.url ?? '#'}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 rounded-btn border border-line bg-surface px-2.5 py-2 text-[13px] transition hover:border-accent"
                >
                  {isImage && attachment.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL; next/image cannot cache it
                    <img src={attachment.url} alt={attachment.caption ?? ''} className="size-16 rounded object-cover" />
                  ) : (
                    <FileText className="size-5 text-ink-faint" />
                  )}
                  <span className="max-w-[200px] truncate">
                    {attachment.document?.title ?? attachment.caption ?? t('Photo')}
                  </span>
                </a>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={t('Remove')}
                    disabled={pending}
                    onClick={() => run(() => removeChangeOrderAttachment(changeOrder.id, attachment.id))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && available.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder={t('Attach a document from the site')} />
            </SelectTrigger>
            <SelectContent>
              {available.map((document) => (
                <SelectItem key={document.id} value={document.id}>
                  {document.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!choice || pending}
            onClick={() => run(() => attachChangeOrderDocument(changeOrder.id, choice))}
          >
            <Paperclip className="size-4" />
            {t('Attach')}
          </Button>
        </div>
      )}
    </Card>
  );
}

// --- small pieces --------------------------------------------------------------------------------

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12.5px] text-ink-muted">{label}</dt>
      <dd className={`font-mono text-[15px] ${strong ? 'font-bold' : ''}`}>{value}</dd>
    </div>
  );
}

function Step({ label, who, when, note }: { label: string; who?: string | null; when: string; note?: string | null }) {
  return (
    <li className="flex flex-col border-s-2 border-line ps-3">
      <span className="font-medium">{label}</span>
      <span className="text-[12px] text-ink-muted" suppressHydrationWarning>
        {[who, when].filter(Boolean).join(' · ')}
      </span>
      {note && <span className="text-[12.5px] text-ink-soft">“{note}”</span>}
    </li>
  );
}

function BeforeAfter({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12.5px] text-ink-muted">{label}</dt>
      <dd className="font-mono text-[13.5px]">
        <span className="text-ink-muted">{before}</span>{' '}
        <span aria-hidden className="inline-block rtl:rotate-180">
          →
        </span>{' '}
        <span className="font-semibold">{after}</span>
      </dd>
    </div>
  );
}
