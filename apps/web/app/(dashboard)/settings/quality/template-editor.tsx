'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArrowDown, ArrowUp, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  QUALITY_ITEM_KINDS,
  qualityToleranceLabel,
  type CreateQualityTemplateInput,
  type QualityItemKind,
  type QualityTemplateView,
} from '@sitebook/shared';
import { useLanguage } from '@/components/language-provider';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  createQualityTemplate,
  deleteQualityTemplate,
  updateQualityTemplate,
} from '@/lib/quality-actions';
import { cn } from '@/lib/utils';
import { isQualityDecimal } from '../../quality/labels';
import { FormError } from '../../quality/quality-ui';
import { TradeSuggestions } from '../../quality/snag-dialogs';

const KIND_LABELS: Record<QualityItemKind, string> = {
  pass_fail: 'Pass / fail',
  number: 'Measurement',
  text: 'Write down',
  photo: 'Photo',
};

/** A line as edited: every field a string or a flag, so an input never holds `null`. */
interface DraftItem {
  key: number;
  label: string;
  kind: QualityItemKind;
  required: boolean;
  photo_required: boolean;
  unit: string;
  target_value: string;
  tolerance_minus: string;
  tolerance_plus: string;
  guidance: string;
}

let nextKey = 1;

function draftFrom(item: Partial<QualityTemplateView['items'][number]>): DraftItem {
  return {
    key: nextKey++,
    label: item.label ?? '',
    kind: item.kind ?? 'pass_fail',
    required: item.required ?? true,
    photo_required: item.photo_required ?? false,
    unit: item.unit ?? '',
    target_value: item.target_value ?? '',
    tolerance_minus: item.tolerance_minus ?? '',
    tolerance_plus: item.tolerance_plus ?? '',
    guidance: item.guidance ?? '',
  };
}

/**
 * The lines as the API takes them, or the first thing wrong in words. Only a measurement has a
 * target and tolerance; anything typed into those fields on another kind of line is dropped rather
 * than refused, since switching a line's kind should not strand what was typed.
 */
export function itemsForApi(
  items: DraftItem[],
): { items: CreateQualityTemplateInput['items'] } | { error: string } {
  const lines = items.filter((item) => item.label.trim());
  if (lines.length === 0) return { error: 'A checklist needs at least one line' };
  const out: CreateQualityTemplateInput['items'] = [];
  for (const item of lines) {
    const number = item.kind === 'number';
    const target = number ? item.target_value.trim() : '';
    const minus = number ? item.tolerance_minus.trim() : '';
    const plus = number ? item.tolerance_plus.trim() : '';
    for (const value of [target, minus, plus]) {
      if (value && !isQualityDecimal(value)) return { error: `“${item.label.trim()}”: targets and tolerances are numbers` };
    }
    if ((minus.startsWith('-') || plus.startsWith('-'))) {
      return { error: `“${item.label.trim()}”: a tolerance is a distance, never negative` };
    }
    if (!target && (minus || plus)) {
      return { error: `“${item.label.trim()}”: a tolerance needs a target to measure from` };
    }
    out.push({
      label: item.label.trim(),
      kind: item.kind,
      required: item.required,
      photo_required: item.kind === 'photo' ? true : item.photo_required,
      unit: item.unit.trim() || null,
      target_value: target || null,
      tolerance_minus: minus || null,
      tolerance_plus: plus || null,
      guidance: item.guidance.trim() || null,
    });
  }
  return { items: out };
}

/**
 * One checklist, edited as a list of cards and saved whole. Saving replaces every line — safe,
 * because an inspection copied the lines it was run with, so editing the library never rewrites
 * what somebody already signed.
 */
export function QualityTemplateEditor({
  template,
  canManage,
}: {
  template: QualityTemplateView;
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const editable = canManage && template.active;
  const [name, setName] = useState(template.name);
  const [trade, setTrade] = useState(template.trade ?? '');
  const [description, setDescription] = useState(template.description ?? '');
  const [items, setItems] = useState<DraftItem[]>(() => template.items.map(draftFrom));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(key: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    setDirty(true);
  }

  function move(index: number, by: -1 | 1) {
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved!);
      return next;
    });
    setDirty(true);
  }

  function save() {
    setError(null);
    const parsed = itemsForApi(items);
    if ('error' in parsed) {
      setError(t(parsed.error));
      return;
    }
    if (!name.trim()) {
      setError(t('Give the checklist a name'));
      return;
    }
    start(async () => {
      const result = await updateQualityTemplate(template.id, {
        name: name.trim(),
        trade: trade.trim() || null,
        description: description.trim() || null,
        items: parsed.items,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the checklist'));
        return;
      }
      setItems(result.data.items.map(draftFrom));
      setDirty(false);
      toast.success(t('Checklist saved'));
      router.refresh();
    });
  }

  function setActive(active: boolean) {
    start(async () => {
      const result = await updateQualityTemplate(template.id, { active });
      if (!result.ok) {
        toast.error(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(active ? t('Checklist restored') : t('Checklist archived'));
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        {editable ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
              className="h-9 max-w-[360px] font-semibold"
              aria-label={t('Checklist name')}
              maxLength={120}
            />
            <div className="flex flex-wrap gap-2">
              <Input
                value={trade}
                onChange={(event) => {
                  setTrade(event.target.value);
                  setDirty(true);
                }}
                className="h-9 w-[180px]"
                placeholder={t('Trade')}
                aria-label={t('Trade')}
                list="template-trades"
                maxLength={60}
              />
              <TradeSuggestions id="template-trades" />
              <Input
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setDirty(true);
                }}
                className="h-9 min-w-[220px] flex-1"
                placeholder={t('What it is for')}
                aria-label={t('Description')}
                maxLength={1000}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              {template.name}
              {!template.active && <Badge tone="neutral">{t('Archived')}</Badge>}
            </span>
            <span className="text-[12.5px] text-ink-muted">
              {[template.trade, template.description].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {template.active ? (
              <>
                <ConfirmDialog
                  title={template.inspection_count > 0 ? t('Archive this checklist?') : t('Delete this checklist?')}
                  body={
                    template.inspection_count > 0
                      ? t('It has been used, so it is archived rather than deleted: past inspections keep it, and it can be restored.')
                      : t('It has never been used, so it is deleted outright.')
                  }
                  confirmLabel={template.inspection_count > 0 ? t('Archive') : t('Delete')}
                  onConfirm={async () => {
                    const result = await deleteQualityTemplate(template.id);
                    if (result.ok && template.inspection_count === 0) router.push('/settings/quality');
                    return result;
                  }}
                  trigger={
                    <Button type="button" variant="ghost" size="sm" disabled={pending}>
                      {template.inspection_count > 0 ? <Archive className="size-4" /> : <Trash2 className="size-4" />}
                      {template.inspection_count > 0 ? t('Archive') : t('Delete')}
                    </Button>
                  }
                />
                <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t('Save')}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={() => setActive(true)} disabled={pending}>
                <RotateCcw className="size-4" />
                {t('Restore')}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3">
          <FormError error={error} />
        </div>
      )}

      <ol className="flex flex-col divide-y divide-line-soft">
        {items.map((item, index) =>
          editable ? (
            <li key={item.key} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 font-mono text-[12px] text-ink-muted">{index + 1}</span>
                <Input
                  value={item.label}
                  onChange={(event) => change(item.key, { label: event.target.value })}
                  className="h-9 min-w-[220px] flex-1"
                  placeholder={t('What to check')}
                  aria-label={t('Check')}
                  maxLength={300}
                />
                <Select value={item.kind} onValueChange={(value) => change(item.key, { kind: value as QualityItemKind })}>
                  <SelectTrigger className="h-9 w-[150px] text-[13.5px]" aria-label={t('Kind')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUALITY_ITEM_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(KIND_LABELS[kind])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={t('Move up')}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={t('Move down')}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-ink-faint hover:text-blocked-fg"
                    onClick={() => {
                      setItems((current) => current.filter((row) => row.key !== item.key));
                      setDirty(true);
                    }}
                    aria-label={t('Remove this line')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 ps-8 text-[13px]">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(event) => change(item.key, { required: event.target.checked })}
                    className="size-4 accent-accent"
                  />
                  {t('Required')}
                </label>
                {item.kind !== 'photo' && (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={item.photo_required}
                      onChange={(event) => change(item.key, { photo_required: event.target.checked })}
                      className="size-4 accent-accent"
                    />
                    {t('Photo required')}
                  </label>
                )}
                {item.kind === 'number' && (
                  <>
                    <SmallInput label={t('Target')} value={item.target_value} onChange={(v) => change(item.key, { target_value: v })} />
                    <SmallInput label={`− ${t('tolerance')}`} value={item.tolerance_minus} onChange={(v) => change(item.key, { tolerance_minus: v })} />
                    <SmallInput label={`+ ${t('tolerance')}`} value={item.tolerance_plus} onChange={(v) => change(item.key, { tolerance_plus: v })} />
                    <SmallInput label={t('Unit')} value={item.unit} onChange={(v) => change(item.key, { unit: v })} wide />
                  </>
                )}
              </div>
              <div className="ps-8">
                <Input
                  value={item.guidance}
                  onChange={(event) => change(item.key, { guidance: event.target.value })}
                  className="h-8 text-[13px]"
                  placeholder={t('How to check it (shown under the line)')}
                  aria-label={t('Guidance')}
                  maxLength={500}
                />
              </div>
            </li>
          ) : (
            <li key={item.key} className="flex flex-wrap items-baseline gap-2 px-4 py-2.5 text-[14px]">
              <span className="w-6 font-mono text-[12px] text-ink-muted">{index + 1}</span>
              <span className="min-w-0 flex-1">
                {item.label}
                {item.required && <span className="ms-1 text-blocked-fg">*</span>}
                {item.guidance && <span className="block text-[12.5px] text-ink-muted">{item.guidance}</span>}
              </span>
              <span className="text-[12px] text-ink-muted">{t(KIND_LABELS[item.kind])}</span>
              {item.kind === 'number' && item.target_value && (
                <span className="font-mono text-[12px]" dir="ltr">
                  {qualityToleranceLabel(
                    {
                      target: item.target_value || null,
                      minus: item.tolerance_minus || null,
                      plus: item.tolerance_plus || null,
                    },
                    item.unit,
                  )}
                </span>
              )}
              {(item.photo_required || item.kind === 'photo') && (
                <Badge tone="neutral" dot={false}>
                  {t('Photo')}
                </Badge>
              )}
            </li>
          ),
        )}
      </ol>

      {editable && (
        <div className="border-t border-line-soft px-4 py-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setItems((current) => [...current, draftFrom({})]);
              setDirty(true);
            }}
          >
            <Plus className="size-4" />
            {t('Add line')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function SmallInput({
  label,
  value,
  onChange,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-ink-muted">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn('h-8 font-mono text-[13px]', wide ? 'w-[90px]' : 'w-[70px]')}
        inputMode={wide ? 'text' : 'decimal'}
        dir="ltr"
        maxLength={30}
      />
    </label>
  );
}

/** A new checklist: blank, or a copy of one in the library to adapt. */
export function NewQualityTemplateDialog({ templates }: { templates: QualityTemplateView[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('blank');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError(t('Give the checklist a name'));
      return;
    }
    const from = templates.find((template) => template.id === source);
    // A template needs at least one line, so a blank one starts with a single question to edit.
    const parsed = from
      ? itemsForApi(from.items.map(draftFrom))
      : itemsForApi([draftFrom({ label: t('First check') })]);
    if ('error' in parsed) {
      setError(t(parsed.error));
      return;
    }
    start(async () => {
      const result = await createQualityTemplate({
        name,
        trade: from?.trade ?? null,
        description: from?.description ?? null,
        items: parsed.items,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not create the checklist'));
        return;
      }
      setOpen(false);
      router.push(`/settings/quality?template=${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {t('New checklist')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('New checklist')}</DialogTitle>
          <DialogDescription>{t('Start blank, or from a checklist already in the library.')}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Name')} htmlFor="qt-name">
            <Input id="qt-name" name="name" maxLength={120} required placeholder={t('Handover — apartment')} />
          </Field>
          <Field label={t('Start from')}>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">{t('Nothing — a blank checklist')}</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
