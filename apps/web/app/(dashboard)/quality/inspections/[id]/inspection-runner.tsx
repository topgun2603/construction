'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  Check,
  Loader2,
  MessageSquare,
  Minus,
  PenLine,
  Printer,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  qualityMeasurementOutcome,
  qualityToleranceLabel,
  type QualityInspectionItemView,
  type QualityInspectionView,
  type QualityItemOutcome,
  type RecordQualityInspectionItemsInput,
} from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
import {
  completeInspection,
  deleteInspection,
  saveInspectionItems,
  signInspection,
} from '@/lib/quality-actions';
import { cn } from '@/lib/utils';
import { INSPECTION_RESULT, isQualityDecimal, SNAG_STATUS } from '../../labels';
import { FormError, PhotoStrip } from '../../quality-ui';
import { uploadQualityFile } from '../../upload';

type Answer = RecordQualityInspectionItemsInput['items'][number];

/**
 * The checklist runner, built for a phone held in one hand on a slab.
 *
 * One card per line, big targets for pass / fail / not applicable, and every answer saved the
 * moment it is given — a phone that loses signal or a battery halfway down a forty-line pour card
 * must not take the first twenty answers with it. The server's copy of the inspection comes back
 * from each save and replaces ours, so what the screen shows is always what was stored.
 */
export function InspectionRunner({
  initial,
  canInspect,
  canCountersign,
  signerName,
}: {
  initial: QualityInspectionView;
  canInspect: boolean;
  canCountersign: boolean;
  signerName: string;
}) {
  const { t } = useLanguage();
  const { longDate, instantDate, timeOfDay } = useFormat();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const editable = canInspect && view.status === 'in_progress';

  async function save(answer: Answer): Promise<boolean> {
    setSaving(answer.id);
    const result = await saveInspectionItems(view.id, [answer]);
    setSaving(null);
    if (!result.ok || !result.data) {
      toast.error(result.error ?? t('That answer was not saved. Try again.'));
      return false;
    }
    setView(result.data);
    return true;
  }

  const { answered, total, failed } = view.counts;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/projects/${view.project.id}?tab=quality`}
          className="text-[12.5px] text-ink-faint hover:underline"
        >
          {view.project.name}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-semibold leading-tight">{view.title}</h2>
          {view.status === 'in_progress' || !view.result ? (
            <Badge tone="accent">{t('In progress')}</Badge>
          ) : (
            <Badge tone={INSPECTION_RESULT[view.result].tone}>{t(INSPECTION_RESULT[view.result].label)}</Badge>
          )}
        </div>
        <span className="text-[13px] text-ink-muted">
          <span className="font-mono">#{view.number}</span> · {view.location} · {longDate(view.inspection_date)}
          {view.inspector ? ` · ${view.inspector.name}` : ''}
        </span>
        {(view.cost_code || view.milestone) && (
          <span className="text-[12.5px] text-ink-muted">
            {view.cost_code ? `${view.cost_code.code} ${view.cost_code.name}` : ''}
            {view.cost_code && view.milestone ? ' · ' : ''}
            {view.milestone?.name ?? ''}
          </span>
        )}
      </div>

      {/* Sticky so the count is in view all the way down a long checklist. */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-3 py-2">
        <span className="text-[13px]">
          <span className="font-mono font-semibold">
            {answered}/{total}
          </span>{' '}
          {t('answered')}
          {failed > 0 && (
            <span className="ms-2 font-semibold text-blocked-fg">
              {failed} {t('failed')}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="size-4 animate-spin text-ink-faint" aria-label={t('Saving')} />}
          {view.status === 'completed' && (
            <Link
              href={`/quality/inspections/${view.id}/print`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Printer className="size-4" /> {t('Print')}
            </Link>
          )}
        </div>
      </div>

      {view.notes && (
        <p className="rounded-panel border border-line bg-raised px-3 py-2 text-[13.5px] leading-relaxed">{view.notes}</p>
      )}

      <ol className="flex flex-col gap-3">
        {view.items.map((item, index) => (
          <li key={item.id}>
            <ItemCard
              item={item}
              index={index + 1}
              editable={editable}
              saving={saving === item.id}
              projectId={view.project.id}
              onSave={save}
            />
          </li>
        ))}
      </ol>

      {editable && (
        <div className="flex flex-col gap-3">
          {view.problems.length > 0 && (
            <Card className="flex flex-col gap-1.5 border-pending/40 bg-pending-bg p-3 text-pending-fg">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <AlertTriangle className="size-4" /> {t('Before it can be signed')}
              </span>
              <ul className="flex list-disc flex-col gap-0.5 ps-5 text-[13px]">
                {view.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Card>
          )}
          <CompleteDialog view={view} signerName={signerName} onDone={setView} />
          <ConfirmDialog
            title={t('Delete this inspection?')}
            body={t('The answers given so far are deleted with it. A signed inspection can never be deleted.')}
            confirmLabel={t('Delete')}
            onConfirm={async () => {
              const result = await deleteInspection(view.id, view.project.id);
              if (result.ok) router.push('/quality?tab=inspections');
              return result;
            }}
            trigger={
              <Button variant="ghost" size="sm" className="self-center text-ink-muted">
                {t('Delete this inspection')}
              </Button>
            }
          />
        </div>
      )}

      {view.status === 'completed' && (
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('Signatures')}
          </span>
          <ul className="flex flex-col gap-2">
            {view.signoffs.map((signoff) => (
              <li key={`${signoff.party}-${signoff.signed_at}`} className="flex flex-wrap items-baseline justify-between gap-2 text-[13.5px]">
                <span>
                  <span className="font-semibold">{signoff.signature_name}</span>
                  <span className="ms-1.5 text-ink-muted">{t(PARTY_LABELS[signoff.party])}</span>
                  {!signoff.accepted && (
                    <Badge tone="blocked" className="ms-2">
                      {t('Not accepted')}
                    </Badge>
                  )}
                  {signoff.note && <span className="block text-[12.5px] text-ink-muted">{signoff.note}</span>}
                </span>
                <span className="font-mono text-[12px] text-ink-muted">
                  {instantDate(signoff.signed_at)} {timeOfDay(signoff.signed_at)}
                </span>
              </li>
            ))}
          </ul>
          {canCountersign && <CountersignDialog view={view} signerName={signerName} onDone={setView} />}
        </Card>
      )}
    </div>
  );
}

const PARTY_LABELS = { inspector: 'Inspector', client: 'Client', consultant: 'Consultant' } as const;

const OUTCOME_BUTTONS: Array<{ outcome: QualityItemOutcome; label: string; icon: typeof Check; on: string }> = [
  { outcome: 'pass', label: 'Pass', icon: Check, on: 'border-done bg-done-bg text-done-fg' },
  { outcome: 'fail', label: 'Fail', icon: X, on: 'border-blocked bg-blocked-bg text-blocked-fg' },
  { outcome: 'na', label: 'N/A', icon: Minus, on: 'border-ink-muted bg-neutral-bg text-ink' },
];

/** One checklist line: the question, the answer controls for its kind, photos and a comment. */
function ItemCard({
  item,
  index,
  editable,
  saving,
  projectId,
  onSave,
}: {
  item: QualityInspectionItemView;
  index: number;
  editable: boolean;
  saving: boolean;
  projectId: string;
  onSave: (answer: Answer) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [number, setNumber] = useState(item.number_value ?? '');
  const [text, setText] = useState(item.text_value ?? '');
  const [comment, setComment] = useState(item.comment ?? '');
  const [showComment, setShowComment] = useState(Boolean(item.comment));
  const [uploading, setUploading] = useState(false);
  const [, start] = useTransition();
  const cameraInput = useRef<HTMLInputElement>(null);

  const tolerance = { target: item.target_value, minus: item.tolerance_minus, plus: item.tolerance_plus };
  const toleranceText = qualityToleranceLabel(tolerance, item.unit);
  // Judged as it is typed, so the inspector sees the verdict before they move on.
  const live = item.kind === 'number' && isQualityDecimal(number) ? qualityMeasurementOutcome(number.trim(), tolerance) : null;
  const needsPhoto = item.kind === 'photo' || item.photo_required;
  const failed = item.outcome === 'fail';

  function saveNumber() {
    const trimmed = number.trim();
    if (trimmed === (item.number_value ?? '')) return;
    if (trimmed && !isQualityDecimal(trimmed)) {
      toast.error(t('Enter the reading as a number, like 42.5'));
      return;
    }
    // A reading un-marks "not applicable": the line was measured after all.
    start(async () => {
      await onSave({
        id: item.id,
        number_value: trimmed || null,
        ...(item.outcome === 'na' ? { outcome: null } : {}),
      });
    });
  }

  async function addPhotos(files: File[]) {
    setUploading(true);
    const keys = item.photos.map((photo) => photo.s3_key);
    for (const file of files) {
      const uploaded = await uploadQualityFile(file, 'quality_photo', projectId);
      if (!uploaded.ok) {
        toast.error(t(uploaded.error));
        break;
      }
      keys.push(uploaded.key);
    }
    if (keys.length > item.photos.length) await onSave({ id: item.id, photo_keys: keys.slice(0, 12) });
    setUploading(false);
  }

  return (
    <Card className={cn('flex flex-col gap-3 p-3.5', failed && 'border-blocked/50')}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full bg-neutral-bg font-mono text-[11.5px] text-ink-soft">
          {index}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium leading-snug">
            {item.label}
            {item.required && <span className="ms-1 text-blocked-fg" aria-label={t('Required')}>*</span>}
          </span>
          {item.guidance && <span className="text-[12.5px] leading-snug text-ink-muted">{item.guidance}</span>}
          {needsPhoto && (
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
              <Camera className="size-3" /> {t('Photo required')}
            </span>
          )}
        </div>
        {saving && <Loader2 className="size-4 flex-none animate-spin text-ink-faint" />}
      </div>

      {/* --- the answer ------------------------------------------------------------------------- */}
      {(item.kind === 'pass_fail' || item.kind === 'photo') &&
        (editable ? (
          <div className="grid grid-cols-3 gap-2">
            {OUTCOME_BUTTONS.map((button) => {
              const Icon = button.icon;
              const chosen = item.outcome === button.outcome;
              return (
                <button
                  key={button.outcome}
                  type="button"
                  aria-pressed={chosen}
                  disabled={saving}
                  // Tapping the chosen answer again clears it — the way to undo a mis-tap.
                  onClick={() => void onSave({ id: item.id, outcome: chosen ? null : button.outcome })}
                  className={cn(
                    'flex h-14 items-center justify-center gap-1.5 rounded-[12px] border text-[15px] font-semibold transition disabled:opacity-60',
                    chosen ? button.on : 'border-line-strong bg-surface text-ink-soft hover:bg-raised',
                  )}
                >
                  <Icon className="size-5" />
                  {t(button.label)}
                </button>
              );
            })}
          </div>
        ) : (
          <OutcomeBadge outcome={item.outcome} />
        ))}

      {item.kind === 'number' && (
        <div className="flex flex-col gap-1.5">
          {toleranceText && (
            <span className="text-[12.5px] text-ink-muted">
              {t('Target')} <span className="font-mono text-ink" dir="ltr">{toleranceText}</span>
            </span>
          )}
          {editable ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  onBlur={saveNumber}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                  }}
                  inputMode="decimal"
                  dir="ltr"
                  className={cn(
                    'h-14 pe-16 font-mono text-[20px]',
                    live === 'pass' && 'border-done',
                    live === 'fail' && 'border-blocked',
                  )}
                  aria-label={item.label}
                  placeholder={item.target_value ?? ''}
                />
                {item.unit && (
                  <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-muted">
                    {item.unit}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-pressed={item.outcome === 'na'}
                disabled={saving}
                onClick={() => {
                  setNumber('');
                  void onSave({ id: item.id, outcome: item.outcome === 'na' ? null : 'na', number_value: null });
                }}
                className={cn(
                  'flex h-14 w-16 flex-none items-center justify-center rounded-[12px] border text-[14px] font-semibold transition',
                  item.outcome === 'na' ? OUTCOME_BUTTONS[2]!.on : 'border-line-strong bg-surface text-ink-soft hover:bg-raised',
                )}
              >
                {t('N/A')}
              </button>
            </div>
          ) : (
            <span className="font-mono text-[16px]" dir="ltr">
              {item.number_value ?? '—'} {item.number_value ? (item.unit ?? '') : ''}
            </span>
          )}
          {(live ?? item.outcome) && (
            <OutcomeBadge outcome={editable && live ? live : item.outcome} />
          )}
        </div>
      )}

      {item.kind === 'text' &&
        (editable ? (
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              if (text.trim() !== (item.text_value ?? '')) void onSave({ id: item.id, text_value: text.trim() || null });
            }}
            className="min-h-[56px]"
            maxLength={2000}
            aria-label={item.label}
          />
        ) : (
          <p className="text-[14px]">{item.text_value ?? '—'}</p>
        ))}

      {/* --- photos and comment ----------------------------------------------------------------- */}
      {item.photos.length > 0 && <PhotoStrip photos={item.photos} />}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={uploading || saving}
            onClick={() => cameraInput.current?.click()}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {t('Photo')}
          </Button>
          {item.photos.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void onSave({ id: item.id, photo_keys: item.photos.slice(0, -1).map((p) => p.s3_key) })}
            >
              {t('Remove last photo')}
            </Button>
          )}
          {!showComment && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowComment(true)}>
              <MessageSquare className="size-4" />
              {t('Comment')}
            </Button>
          )}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void addPhotos(files);
            }}
          />
        </div>
      )}

      {editable && showComment ? (
        <Textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onBlur={() => {
            if (comment.trim() !== (item.comment ?? '')) void onSave({ id: item.id, comment: comment.trim() || null });
          }}
          placeholder={t('What was seen, what was agreed')}
          className="min-h-[56px]"
          maxLength={1000}
          aria-label={t('Comment')}
        />
      ) : (
        !editable &&
        item.comment && <p className="rounded-btn bg-raised px-3 py-2 text-[13px] leading-snug">{item.comment}</p>
      )}

      {item.snag && (
        <Link
          href={`/quality/snags/${item.snag.id}`}
          className="inline-flex items-center gap-2 self-start text-[13px] text-accent hover:underline"
        >
          {t('Snag')} #{item.snag.number}
          <Badge tone={SNAG_STATUS[item.snag.status].tone}>{t(SNAG_STATUS[item.snag.status].label)}</Badge>
        </Link>
      )}
    </Card>
  );
}

function OutcomeBadge({ outcome }: { outcome: QualityItemOutcome | null }) {
  const { t } = useLanguage();
  if (!outcome) return <span className="text-[13px] text-ink-faint">{t('Not answered')}</span>;
  const tone = outcome === 'pass' ? 'done' : outcome === 'fail' ? 'blocked' : 'neutral';
  const label = outcome === 'pass' ? 'Pass' : outcome === 'fail' ? 'Fail' : 'Not applicable';
  return (
    <Badge tone={tone} className="self-start">
      {t(label)}
    </Badge>
  );
}

/**
 * The inspector's signature. A typed name rather than a drawn squiggle: it prints legibly on the
 * report, and the account it was typed from is recorded beside it. A clean pass may be signed down
 * to "pass with comments"; a failed line can never be signed up to anything better.
 */
function CompleteDialog({
  view,
  signerName,
  onDone,
}: {
  view: QualityInspectionView;
  signerName: string;
  onDone: (view: QualityInspectionView) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasFailure = view.counts.failed > 0;
  const blocked = view.problems.length > 0;

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('signature_name') ?? '').trim();
    if (name.length < 2) {
      setError(t('Type your full name to sign'));
      return;
    }
    start(async () => {
      const result = await completeInspection(view.id, {
        signature_name: name,
        ...(formData.get('downgrade') === 'on' ? { result: 'pass_with_comments' as const } : {}),
        notes: String(formData.get('notes') ?? '').trim() || null,
        raise_snags: hasFailure ? formData.get('raise_snags') === 'on' : true,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not sign the inspection'));
        return;
      }
      onDone(result.data);
      setOpen(false);
      toast.success(t('Inspection signed'));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" disabled={blocked} className="w-full">
          <PenLine className="size-5" />
          {t('Sign and complete')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Sign and complete')}</DialogTitle>
          <DialogDescription>
            {hasFailure
              ? `${view.counts.failed} ${t('lines failed, so this is signed as a fail.')}`
              : t('Every line passed or was not applicable.')}{' '}
            {t('Once signed, the answers can no longer change.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Your name, as your signature')} htmlFor="sign-name">
            <Input
              id="sign-name"
              name="signature_name"
              defaultValue={signerName}
              required
              minLength={2}
              maxLength={120}
              className="h-12 text-[17px]"
            />
          </Field>
          <Field label={t('Overall notes')} htmlFor="sign-notes" optional>
            <Textarea id="sign-notes" name="notes" maxLength={2000} defaultValue={view.notes ?? ''} className="min-h-[56px]" />
          </Field>
          {hasFailure ? (
            <label className="flex items-start gap-2 text-[13.5px]">
              <input type="checkbox" name="raise_snags" defaultChecked className="mt-0.5 size-4 accent-accent" />
              <span>{t('Raise a snag for every failed line')}</span>
            </label>
          ) : (
            <label className="flex items-start gap-2 text-[13.5px]">
              <input type="checkbox" name="downgrade" className="mt-0.5 size-4 accent-accent" />
              <span>
                {t('Sign as “pass with comments”')}
                <span className="block text-[12.5px] text-ink-muted">
                  {t('For a pass with something worth noting. Comments on any line do this anyway.')}
                </span>
              </span>
            </label>
          )}
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Sign')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A client's or consultant's countersignature. "Do not accept" is a signature too — it records
 * that they looked and why they disagree, which is evidence either way.
 */
export function CountersignDialog({
  view,
  signerName,
  onDone,
}: {
  view: Pick<QualityInspectionView, 'id' | 'title' | 'number'>;
  signerName: string;
  onDone?: (view: QualityInspectionView) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('signature_name') ?? '').trim();
    const note = String(formData.get('note') ?? '').trim();
    if (name.length < 2) {
      setError(t('Type your full name to sign'));
      return;
    }
    if (!accepted && !note) {
      setError(t('Say what is not acceptable, so the team can act on it'));
      return;
    }
    start(async () => {
      const result = await signInspection(view.id, { signature_name: name, accepted, note: note || null });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not sign the inspection'));
        return;
      }
      onDone?.(result.data);
      setOpen(false);
      toast.success(accepted ? t('Countersigned') : t('Recorded as not accepted'));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="self-start">
          <PenLine className="size-4" />
          {t('Countersign')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('Countersign')} #{view.number}
          </DialogTitle>
          <DialogDescription>{view.title}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [true, 'Accept'],
                [false, 'Do not accept'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={accepted === value}
                onClick={() => setAccepted(value)}
                className={cn(
                  'h-12 rounded-[12px] border text-[14px] font-semibold transition',
                  accepted === value
                    ? value
                      ? 'border-done bg-done-bg text-done-fg'
                      : 'border-blocked bg-blocked-bg text-blocked-fg'
                    : 'border-line-strong bg-surface text-ink-soft hover:bg-raised',
                )}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <Field label={t('Your name, as your signature')} htmlFor="countersign-name">
            <Input id="countersign-name" name="signature_name" defaultValue={signerName} required minLength={2} maxLength={120} />
          </Field>
          <Field label={t('Note')} htmlFor="countersign-note" optional={accepted}>
            <Textarea id="countersign-note" name="note" maxLength={1000} className="min-h-[56px]" />
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Sign')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
