'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { compareCostCodes, impliedParentCode, parseCostCodeCsv } from '@sitebook/shared';
import {
  createCostCodeTemplate,
  deleteCostCodeTemplate,
  updateCostCodeTemplate,
} from '@/lib/cost-code-actions';
import type {
  CostCodeTemplate,
  CostCodeTemplateLine,
  CostCodeTemplateSummary,
} from '@/lib/cost-code-types';
import { useLanguage } from '@/components/language-provider';
import { DeleteRowButton } from '@/components/delete-row-button';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Depth from the parent chain, for indenting; a broken chain stops rather than loops. */
function depthOf(line: CostCodeTemplateLine, byCode: Map<string, CostCodeTemplateLine>): number {
  let depth = 0;
  let at = line.parent_code;
  const seen = new Set<string>();
  while (at && byCode.has(at) && !seen.has(at)) {
    seen.add(at);
    depth += 1;
    at = byCode.get(at)!.parent_code;
  }
  return depth;
}

/**
 * One template's lines, edited as a list and saved whole.
 *
 * A list rather than a tree editor: a template is typed in once from somebody's spreadsheet and
 * touched rarely after, and the tree is already in the codes — `03.20` sits under `03` without
 * anybody dragging it there. Parents default to what the code implies.
 */
export function TemplateEditor({
  template,
  canManage,
}: {
  template: CostCodeTemplate;
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const editable = canManage && !template.builtin;
  const [name, setName] = useState(template.name);
  const [lines, setLines] = useState<CostCodeTemplateLine[]>(template.lines);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const byCode = new Map(lines.map((line) => [line.code, line]));

  function change(index: number, patch: Partial<CostCodeTemplateLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    setDirty(true);
  }

  function addLine() {
    setLines((current) => [...current, { code: '', name: '', parent_code: null, unit: null }]);
    setDirty(true);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  }

  /** Lines from a sheet replace the list in the editor; nothing is saved until Save. */
  async function onFile(file: File) {
    const parsed = parseCostCodeCsv(await file.text(), 2);
    if (fileInput.current) fileInput.current.value = '';
    if (parsed.rows.length === 0) {
      setError(parsed.errors[0]?.message ?? t('Nothing in that file could be read'));
      return;
    }
    setLines(
      parsed.rows.map((row) => ({
        code: row.code,
        name: row.name,
        parent_code: row.parent_code,
        unit: row.unit,
      })),
    );
    setDirty(true);
    setError(
      parsed.errors.length > 0
        ? `${parsed.errors.length} ${t('lines could not be read and were left out')}`
        : null,
    );
  }

  function save() {
    setError(null);
    const cleaned = lines
      .map((line) => ({
        code: line.code.trim(),
        name: line.name.trim(),
        unit: line.unit?.trim() || null,
        parent_code: line.parent_code?.trim() || null,
      }))
      .filter((line) => line.code || line.name);
    const codes = new Set(cleaned.map((line) => line.code));
    // A blank parent takes the one the code implies, the same rule the site import uses.
    const items = cleaned.map((line) => {
      const implied = impliedParentCode(line.code);
      return {
        ...line,
        parent_code: line.parent_code ?? (implied && codes.has(implied) ? implied : null),
      };
    });
    if (items.some((line) => !line.code || !line.name)) {
      setError(t('Every line needs a code and a name'));
      return;
    }
    start(async () => {
      const result = await updateCostCodeTemplate(template.id, {
        ...(name.trim() !== template.name ? { name: name.trim() } : {}),
        items,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the template'));
        return;
      }
      setLines(result.data.lines);
      setDirty(false);
      toast.success(t('Template saved'));
      router.refresh();
    });
  }

  // Read in WBS order; edited in the order typed, so a row never jumps away mid-keystroke.
  const indexed = lines.map((line, index) => ({ line, index }));
  const sorted = editable
    ? indexed
    : indexed.sort((a, b) => compareCostCodes(a.line.code, b.line.code));

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        {editable ? (
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
            className="h-9 max-w-[320px] font-semibold"
            aria-label={t('Template name')}
            maxLength={120}
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{template.name}</span>
            {template.description && (
              <span className="text-[12.5px] text-ink-muted">{template.description}</span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canManage && template.builtin && (
            <CopyTemplateButton template={template} />
          )}
          {editable && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={pending}
              >
                <Upload className="size-4" />
                {t('Replace from CSV')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
              <DeleteRowButton
                what={template.name}
                body={
                  <>
                    <strong className="font-semibold text-ink">{template.name}</strong>{' '}
                    {t('leaves the library. Sites already started from it keep their codes.')}
                  </>
                }
                successMessage={`${template.name} ${t('deleted')}`}
                onConfirm={async () => {
                  const result = await deleteCostCodeTemplate(template.id);
                  if (result.ok) router.push('/settings/cost-codes');
                  return result;
                }}
              />
              <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t('Save')}
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
          {error}
        </p>
      )}

      <ul className="divide-y divide-line-soft">
        {sorted.map(({ line, index }) => (
          <li key={index} className="flex flex-wrap items-center gap-2 px-4 py-2">
            {editable ? (
              <>
                <Input
                  value={line.code}
                  onChange={(event) => change(index, { code: event.target.value })}
                  className="h-8 w-[100px] font-mono"
                  placeholder="03.20"
                  aria-label={t('Code')}
                  dir="ltr"
                  maxLength={30}
                />
                <Input
                  value={line.name}
                  onChange={(event) => change(index, { name: event.target.value })}
                  className="h-8 min-w-[180px] flex-1"
                  placeholder={t('Footings & foundations')}
                  aria-label={t('Name')}
                  maxLength={120}
                />
                <Input
                  value={line.parent_code ?? ''}
                  onChange={(event) => change(index, { parent_code: event.target.value || null })}
                  className="h-8 w-[90px] font-mono"
                  placeholder={impliedParentCode(line.code) ?? t('Parent')}
                  aria-label={t('Parent code')}
                  dir="ltr"
                  maxLength={30}
                />
                <Input
                  value={line.unit ?? ''}
                  onChange={(event) => change(index, { unit: event.target.value || null })}
                  className="h-8 w-[70px]"
                  placeholder={t('Unit')}
                  aria-label={t('Unit')}
                  maxLength={20}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-ink-faint hover:text-blocked-fg"
                  onClick={() => removeLine(index)}
                  aria-label={`${t('Remove')} ${line.code}`}
                  title={t('Remove this line')}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            ) : (
              <div
                className="flex items-center gap-2 text-[14px]"
                style={{ paddingInlineStart: depthOf(line, byCode) * 20 }}
              >
                <span className="font-mono text-[12.5px] text-ink-muted">{line.code}</span>
                <span className={depthOf(line, byCode) === 0 ? 'font-semibold' : undefined}>
                  {line.name}
                </span>
                {line.unit && <span className="text-[12px] text-ink-faint">({line.unit})</span>}
              </div>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <div className="border-t border-line-soft px-4 py-3">
          <Button type="button" size="sm" variant="secondary" onClick={addLine}>
            <Plus className="size-4" />
            {t('Add line')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function CopyTemplateButton({ template }: { template: CostCodeTemplateSummary }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await createCostCodeTemplate({
            name: `${template.name} (${t('copy')})`,
            from_template_id: template.id,
          });
          if (!result.ok || !result.data) {
            toast.error(result.error ?? t('Could not copy the template'));
            return;
          }
          router.push(`/settings/cost-codes?template=${result.data.id}`);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
      {t('Make a copy to edit')}
    </Button>
  );
}

/** A new template: blank, or a copy of one already in the library. */
export function NewTemplateDialog({ templates }: { templates: CostCodeTemplateSummary[] }) {
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
      setError(t('Give the template a name'));
      return;
    }
    start(async () => {
      const result = await createCostCodeTemplate({
        name,
        ...(source === 'blank' ? {} : { from_template_id: source }),
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not create the template'));
        return;
      }
      setOpen(false);
      router.push(`/settings/cost-codes?template=${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {t('New template')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('New cost code template')}</DialogTitle>
          <DialogDescription>
            {t('Start blank, or from a template already in the library. To keep a site’s breakdown for the next job, use “Save as template” on that site’s Cost codes tab.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Name')} htmlFor="template-name">
            <Input id="template-name" name="name" maxLength={120} placeholder={t('Villas')} required />
          </Field>
          <Field label={t('Start from')}>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">{t('Nothing — a blank template')}</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
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
