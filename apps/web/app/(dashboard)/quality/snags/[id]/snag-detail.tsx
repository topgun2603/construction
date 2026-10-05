'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ImagePlus, Loader2, Quote, RotateCcw, Sparkles, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { SNAG_PRIORITIES, type SnagPriority, type SnagView } from '@sitebook/shared';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import {
  addSnagPhotos,
  deleteSnag,
  fixSnag,
  openSnag,
  reopenSnag,
  updateSnag,
  verifySnag,
} from '@/lib/quality-actions';
import { ANY, SNAG_PRIORITY, SNAG_STATUS } from '../../labels';
import { BeforeAfter, FormError, PhotoPicker } from '../../quality-ui';
import { TradeSuggestions, type PersonOption } from '../../snag-dialogs';
import { uploadQualityPhotos } from '../../upload';

/** What each event in the history says. The API names them; anything new reads as its own name. */
const EVENT_LABELS: Record<string, string> = {
  drafted: 'Captured as a draft',
  raised: 'Raised',
  confirmed: 'Confirmed',
  fixed: 'Marked fixed',
  closed: 'Checked and closed',
  reopened: 'Reopened',
};

/**
 * One snag: its pictures before and after, its details, the next step in its life, and the record
 * of who did what. The buttons offered are exactly the moves the API would accept from this status
 * for this person — confirming and fixing for whoever inspects, closing and reopening only for
 * whoever verifies, which is the check on whoever did the fixing.
 */
export function SnagDetail({
  initial,
  canEdit,
  canVerify,
  people,
  contractors,
}: {
  initial: SnagView;
  canEdit: boolean;
  canVerify: boolean;
  people: PersonOption[];
  contractors: PersonOption[];
}) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay, shortDate } = useFormat();
  const router = useRouter();
  const [snag, setSnag] = useState(initial);
  const [pending, start] = useTransition();

  function run(action: () => Promise<{ ok: boolean; data?: SnagView; error?: string }>, done: string) {
    start(async () => {
      const result = await action();
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('That did not work. Try again.'));
        return;
      }
      setSnag(result.data);
      toast.success(done);
      router.refresh();
    });
  }

  const status = SNAG_STATUS[snag.status];
  const editable = canEdit && snag.status !== 'closed';

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Link href={`/projects/${snag.project.id}?tab=quality`} className="text-[12.5px] text-ink-faint hover:underline">
          {snag.project.name}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-semibold leading-tight">
            <span className="me-1.5 font-mono text-[15px] text-ink-muted">#{snag.number}</span>
            {snag.title}
          </h2>
          <Badge tone={status.tone}>{t(status.label)}</Badge>
          <Badge tone={SNAG_PRIORITY[snag.priority].tone} dot={false}>
            {t(SNAG_PRIORITY[snag.priority].label)}
          </Badge>
          {snag.overdue && <Badge tone="blocked">{t('Overdue')}</Badge>}
        </div>
        <span className="text-[13px] text-ink-muted">
          {snag.raised_by ? `${t('Raised by')} ${snag.raised_by.name} · ` : ''}
          {instantDate(snag.raised_at)} · {snag.age_days} {t('days old')}
          {snag.reopen_count > 0 ? ` · ${t('reopened')} ${snag.reopen_count}×` : ''}
        </span>
        {(snag.inspection || snag.test) && (
          <span className="text-[13px]">
            {snag.inspection && (
              <Link href={`/quality/inspections/${snag.inspection.id}`} className="text-accent hover:underline">
                {t('From inspection')} #{snag.inspection.number} · {snag.inspection.title}
              </Link>
            )}
            {snag.test && (
              <Link href="/quality?tab=tests" className="text-accent hover:underline">
                {t('From failed test')} {snag.test.sample_ref}
              </Link>
            )}
          </span>
        )}
      </div>

      {snag.status === 'draft' && (
        <Card className="flex flex-col gap-2 border-pending/40 bg-pending-bg p-3 text-pending-fg">
          <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
            <Sparkles className="size-4" />
            {snag.ai_suggested
              ? t('A draft — the title, trade and priority were suggested by AI. Check them before confirming.')
              : t('A draft from quick capture — check the title, trade and priority before confirming.')}
          </span>
        </Card>
      )}

      {snag.transcript && (
        <figure className="rounded-panel border border-line bg-surface p-3">
          <figcaption className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            <Quote className="size-3" />
            {t('What was said')}
          </figcaption>
          {/* Verbatim, in the speaker's own words and script: the thing to check the draft against. */}
          <blockquote className="text-[14px] leading-relaxed">{snag.transcript}</blockquote>
        </figure>
      )}

      {/* --- the next step ---------------------------------------------------------------------- */}
      <div className="flex flex-wrap gap-2">
        {snag.status === 'draft' && canEdit && (
          <>
            <Button disabled={pending} onClick={() => run(() => openSnag(snag.id), t('Snag confirmed'))}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {t('Confirm snag')}
            </Button>
            <ConfirmDialog
              title={t('Discard this draft?')}
              body={t('It was never confirmed, so nobody has been given it. The photos go with it.')}
              confirmLabel={t('Discard')}
              onConfirm={async () => {
                const result = await deleteSnag(snag.id, snag.project.id);
                if (result.ok) router.push('/quality');
                return result;
              }}
              trigger={<Button variant="destructive">{t('Discard draft')}</Button>}
            />
          </>
        )}
        {snag.status === 'open' && canEdit && <FixDialog snag={snag} onDone={setSnag} />}
        {snag.status === 'fixed' && canVerify && <VerifyDialog snag={snag} onDone={setSnag} />}
        {(snag.status === 'fixed' || snag.status === 'closed') && canVerify && (
          <ReopenDialog snag={snag} onDone={setSnag} />
        )}
        {snag.status === 'fixed' && !canVerify && (
          <p className="text-[13px] text-ink-muted">{t('Waiting for somebody who can verify the fix to close it.')}</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Photos')}</span>
          {snag.photos.length > 0 ? (
            <BeforeAfter photos={snag.photos} size="lg" />
          ) : (
            <p className="text-[13px] text-ink-muted">{t('No photos yet.')}</p>
          )}
          {editable && <AddBeforePhotos snag={snag} onDone={setSnag} />}
        </Card>

        <DetailsCard
          snag={snag}
          editable={editable}
          people={people}
          contractors={contractors}
          onDone={setSnag}
          dueLabel={snag.due_on ? shortDate(snag.due_on) : null}
        />
      </div>

      {snag.events && snag.events.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('History')}</span>
          <ol className="flex flex-col gap-3 border-s border-line ps-4">
            {snag.events.map((event, index) => (
              <li key={`${event.at}-${index}`} className="relative flex flex-col gap-0.5">
                <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-accent" />
                <span className="text-[13.5px] font-medium">
                  {t(EVENT_LABELS[event.action] ?? event.action)}
                  {event.actor && <span className="font-normal text-ink-muted"> · {event.actor.name}</span>}
                </span>
                <span className="font-mono text-[12px] text-ink-muted">
                  {instantDate(event.at)} {timeOfDay(event.at)}
                </span>
                {event.note && <span className="text-[13px] leading-snug">{event.note}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

/** The snag's details: read as a list, or edited in place by somebody who inspects. */
function DetailsCard({
  snag,
  editable,
  people,
  contractors,
  onDone,
  dueLabel,
}: {
  snag: SnagView;
  editable: boolean;
  people: PersonOption[];
  contractors: PersonOption[];
  onDone: (snag: SnagView) => void;
  dueLabel: string | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [priority, setPriority] = useState<SnagPriority>(snag.priority);
  const [userId, setUserId] = useState(snag.assigned_user?.id ?? ANY);
  const [contractorId, setContractorId] = useState(snag.assigned_contractor?.id ?? ANY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Somebody already assigned but no longer on the site's list still shows by name.
  const peopleOptions =
    snag.assigned_user && !people.some((person) => person.id === snag.assigned_user!.id)
      ? [snag.assigned_user, ...people]
      : people;
  const contractorOptions =
    snag.assigned_contractor && !contractors.some((c) => c.id === snag.assigned_contractor!.id)
      ? [snag.assigned_contractor, ...contractors]
      : contractors;

  if (!editable) {
    const rows: Array<[string, string | null]> = [
      ['Details', snag.description],
      ['Where', snag.location],
      ['Trade', snag.trade ? t(snag.trade) : null],
      ['Given to', snag.assigned_user?.name ?? null],
      ['Contractor', snag.assigned_contractor?.name ?? null],
      ['Fix by', dueLabel],
      ['Cost code', snag.cost_code ? `${snag.cost_code.code} ${snag.cost_code.name}` : null],
      ['On the client’s punch list', snag.client_visible ? t('Yes') : t('No')],
    ];
    return (
      <Card className="flex flex-col gap-3 p-4">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Details')}</span>
        <dl className="flex flex-col gap-2 text-[13.5px]">
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-[12px] text-ink-muted">{t(label)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      </Card>
    );
  }

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    start(async () => {
      const result = await updateSnag(snag.id, {
        title: read('title'),
        description: read('description') || null,
        location: read('location') || null,
        trade: read('trade') || null,
        priority,
        assigned_user_id: userId === ANY ? null : userId,
        assigned_contractor_id: contractorId === ANY ? null : contractorId,
        due_on: read('due_on') || null,
        client_visible: formData.get('client_visible') === 'on',
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the snag'));
        return;
      }
      onDone(result.data);
      toast.success(t('Snag saved'));
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Details')}</span>
      <form action={submit} className="flex flex-col gap-3">
        <Field label={t('What is wrong')} htmlFor="edit-title">
          <Input id="edit-title" name="title" defaultValue={snag.title} required maxLength={200} />
        </Field>
        <Field label={t('Details')} htmlFor="edit-description" optional>
          <Textarea id="edit-description" name="description" defaultValue={snag.description ?? ''} maxLength={2000} className="min-h-[56px]" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Where')} htmlFor="edit-location" optional>
            <Input id="edit-location" name="location" defaultValue={snag.location ?? ''} maxLength={200} />
          </Field>
          <Field label={t('Trade')} htmlFor="edit-trade" optional>
            <Input id="edit-trade" name="trade" defaultValue={snag.trade ?? ''} maxLength={60} list="edit-trades" />
            <TradeSuggestions id="edit-trades" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Priority')}>
            <Select value={priority} onValueChange={(value) => setPriority(value as SnagPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SNAG_PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(SNAG_PRIORITY[value].label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Fix by')} htmlFor="edit-due" optional>
            <Input id="edit-due" name="due_on" type="date" defaultValue={snag.due_on ?? ''} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Given to')} optional>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('Nobody yet')}</SelectItem>
                {peopleOptions.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Contractor')} optional>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('None')}</SelectItem>
                {contractorOptions.map((contractor) => (
                  <SelectItem key={contractor.id} value={contractor.id}>
                    {contractor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <label className="flex items-start gap-2 text-[13.5px]">
          <input
            type="checkbox"
            name="client_visible"
            defaultChecked={snag.client_visible}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>{t('Show on the client’s punch list')}</span>
        </label>
        <FormError error={error} />
        <Button type="submit" size="sm" disabled={pending} className="self-end">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t('Save')}
        </Button>
      </form>
    </Card>
  );
}

/** More "before" pictures — another angle, or the defect somebody found next to it. */
function AddBeforePhotos({ snag, onDone }: { snag: SnagView; onDone: (snag: SnagView) => void }) {
  const { t } = useLanguage();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const uploaded = await uploadQualityPhotos(files, snag.project.id);
      if (!uploaded.ok) {
        setError(t(uploaded.error));
        return;
      }
      const result = await addSnagPhotos(snag.id, 'before', uploaded.keys);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not add the photos'));
        return;
      }
      setFiles([]);
      onDone(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
      <PhotoPicker files={files} onChange={setFiles} disabled={pending} label={t('Add photo')} />
      {files.length > 0 && (
        <Button type="button" size="sm" variant="secondary" onClick={save} disabled={pending} className="self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {t('Add as “before” photos')}
        </Button>
      )}
      <FormError error={error} />
    </div>
  );
}

/** Done, with the "after" photo that shows it. The photo is required: it is the evidence. */
function FixDialog({ snag, onDone }: { snag: SnagView; onDone: (snag: SnagView) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    if (files.length === 0) {
      setError(t('Take an “after” photo that shows it fixed'));
      return;
    }
    const note = String(formData.get('note') ?? '').trim();
    start(async () => {
      const uploaded = await uploadQualityPhotos(files, snag.project.id);
      if (!uploaded.ok) {
        setError(t(uploaded.error));
        return;
      }
      const result = await fixSnag(snag.id, { note: note || null, photo_keys: uploaded.keys });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not mark it fixed'));
        return;
      }
      onDone(result.data);
      setOpen(false);
      setFiles([]);
      toast.success(t('Marked fixed — waiting to be checked'));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Wrench className="size-4" />
          {t('Mark fixed')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Mark fixed')}</DialogTitle>
          <DialogDescription>
            {t('Photograph it from the same spot as the “before” picture, so whoever checks it can compare.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <PhotoPicker files={files} onChange={setFiles} disabled={pending} label={t('After photo')} />
          <Field label={t('Note')} htmlFor="fix-note" optional>
            <Textarea id="fix-note" name="note" maxLength={1000} className="min-h-[56px]" />
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Mark fixed')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ snag, onDone }: { snag: SnagView; onDone: (snag: SnagView) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const note = String(formData.get('note') ?? '').trim();
    start(async () => {
      const result = await verifySnag(snag.id, note || undefined);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not close the snag'));
        return;
      }
      onDone(result.data);
      setOpen(false);
      toast.success(t('Snag closed'));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="approve">
          <CheckCircle2 className="size-4" />
          {t('Verify and close')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Verify and close')}</DialogTitle>
          <DialogDescription>
            {t('You have looked at the fix and it is good enough to close. If it is not, reopen it instead.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <BeforeAfter photos={snag.photos} />
          <Field label={t('Note')} htmlFor="verify-note" optional>
            <Textarea id="verify-note" name="note" maxLength={1000} className="min-h-[56px]" />
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="approve" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Close snag')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Not fixed after all. The reason is required — it is what the person fixing it reads next. */
function ReopenDialog({ snag, onDone }: { snag: SnagView; onDone: (snag: SnagView) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const reason = String(formData.get('reason') ?? '').trim();
    if (reason.length < 3) {
      setError(t('Say why it is being reopened'));
      return;
    }
    start(async () => {
      const result = await reopenSnag(snag.id, reason);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not reopen the snag'));
        return;
      }
      onDone(result.data);
      setOpen(false);
      toast.success(t('Snag reopened'));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <RotateCcw className="size-4" />
          {t('Reopen')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Reopen this snag')}</DialogTitle>
          <DialogDescription>{t('It goes back on the list as open, with your reason attached.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Why')} htmlFor="reopen-reason">
            <Textarea
              id="reopen-reason"
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              className="min-h-[72px]"
              placeholder={t('Still hollow near the door; two tiles cracked')}
            />
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Reopen')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
