'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { FileText, FlaskConical, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import {
  QUALITY_TEST_DEFAULT_UNITS,
  QUALITY_TEST_TYPE_LABELS,
  QUALITY_TEST_TYPES,
  qualitySpecLabel,
  qualityTestOutcome,
  type QualityTestType,
  type QualityTestView,
} from '@sitebook/shared';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { costCodeOptions } from '@/lib/cost-code-actions';
import type { CostCode } from '@/lib/cost-code-types';
import { createQualityTest, recordTestResult } from '@/lib/quality-actions';
import { ANY, isQualityDecimal, parseCubeAges, TEST_STATE } from './labels';
import { FormError } from './quality-ui';
import type { SiteOption } from './snag-dialogs';
import { uploadQualityFile } from './upload';

/**
 * Material tests: one row per sample and age, so a cube set is two or three rows sharing a sample
 * id, each due on its own day. The state badge is the point of the list — what is due today, what
 * is late at the lab, and what failed.
 */
export function TestsTable({
  tests,
  showSite = true,
  canRecord,
}: {
  tests: QualityTestView[];
  showSite?: boolean;
  canRecord: boolean;
}) {
  const { t } = useLanguage();
  const { shortDate } = useFormat();

  const columns: ColumnDef<QualityTestView>[] = [
    {
      accessorKey: 'sample_ref',
      header: t('Sample'),
      cell: ({ row }) => {
        const test = row.original;
        return (
          <div className="flex flex-col">
            <span className="font-medium">
              <span className="font-mono" dir="ltr">
                {test.sample_ref}
              </span>
              {test.age_days ? ` · ${test.age_days} ${t('days')}` : ''}
            </span>
            <span className="text-[12px] text-ink-muted">
              {test.title ?? t(QUALITY_TEST_TYPE_LABELS[test.test_type])}
              {test.grade ? ` · ${test.grade}` : ''}
              {test.location ? ` · ${test.location}` : ''}
            </span>
          </div>
        );
      },
    },
    ...(showSite
      ? [
          {
            id: 'site',
            accessorFn: (row: QualityTestView) => row.project.name,
            header: t('Site'),
          } satisfies ColumnDef<QualityTestView>,
        ]
      : []),
    {
      id: 'due',
      accessorFn: (row) => row.tested_on ?? row.due_on ?? '',
      header: t('Due / tested'),
      cell: ({ row }) => (
        <span className="font-mono text-[13px]">
          {row.original.tested_on
            ? shortDate(row.original.tested_on)
            : row.original.due_on
              ? shortDate(row.original.due_on)
              : '—'}
        </span>
      ),
    },
    {
      id: 'spec',
      accessorFn: (row) => row.spec_min ?? row.spec_max ?? '',
      header: t('Specification'),
      cell: ({ row }) => (
        <span className="font-mono text-[13px]" dir="ltr">
          {qualitySpecLabel({ min: row.original.spec_min, max: row.original.spec_max }, row.original.unit) || '—'}
        </span>
      ),
    },
    {
      id: 'result',
      accessorFn: (row) => row.result_value ?? '',
      header: t('Result'),
      cell: ({ row }) => {
        const test = row.original;
        const state = TEST_STATE[test.state];
        return (
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-2">
              <Badge tone={state.tone}>{t(state.label)}</Badge>
              {test.result_value && (
                <span className="font-mono text-[13px]" dir="ltr">
                  {test.result_value} {test.unit ?? ''}
                </span>
              )}
            </div>
            <span className="flex items-center gap-2 text-[12px]">
              {test.report?.url && (
                <a
                  href={test.report.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  <FileText className="size-3" /> {t('Lab report')}
                </a>
              )}
              {test.snag && (
                <Link
                  href={`/quality/snags/${test.snag.id}`}
                  className="text-accent hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {t('Snag')} #{test.snag.number}
                </Link>
              )}
            </span>
          </div>
        );
      },
    },
    ...(canRecord
      ? [
          {
            id: 'actions',
            header: '',
            cell: ({ row }) =>
              row.original.result_value === null ? <RecordResultDialog test={row.original} /> : null,
          } satisfies ColumnDef<QualityTestView>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      data={tests}
      searchPlaceholder={t('Search samples')}
      emptyMessage={t('No tests recorded yet.')}
    />
  );
}

/**
 * The lab's figure for one sample. Pass or fail is worked out from the specification — never
 * typed — and shown live so whoever is keying it in sees the verdict before they save it.
 */
export function RecordResultDialog({ test }: { test: QualityTestView }) {
  const { t } = useLanguage();
  const { todayIso } = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [report, setReport] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const spec = { min: test.spec_min, max: test.spec_max };
  const outcome = isQualityDecimal(value) ? qualityTestOutcome(value.trim(), spec) : null;

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!isQualityDecimal(value)) {
      setError(t('Enter the result as a number, like 26.4'));
      return;
    }
    start(async () => {
      let reportKey: string | null = null;
      if (report) {
        const uploaded = await uploadQualityFile(report, 'quality_report', test.project.id);
        if (!uploaded.ok) {
          setError(t(uploaded.error));
          return;
        }
        reportKey = uploaded.key;
      }
      const result = await recordTestResult(test.id, {
        result_value: value.trim(),
        tested_on: read('tested_on') || undefined,
        lab_name: read('lab_name') || null,
        report_s3_key: reportKey,
        notes: read('notes') || null,
        raise_snag: formData.get('raise_snag') === 'on',
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not record the result'));
        return;
      }
      toast.success(
        result.data.result === 'fail'
          ? t('Recorded as a fail')
          : result.data.result === 'pass'
            ? t('Recorded as a pass')
            : t('Result recorded'),
      );
      setOpen(false);
      setValue('');
      setReport(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" onClick={(event) => event.stopPropagation()}>
          {t('Record result')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('Result for')} {test.sample_ref}
            {test.age_days ? ` · ${test.age_days} ${t('days')}` : ''}
          </DialogTitle>
          <DialogDescription>
            {t(QUALITY_TEST_TYPE_LABELS[test.test_type])}
            {qualitySpecLabel(spec, test.unit) ? ` · ${t('Spec')} ${qualitySpecLabel(spec, test.unit)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${t('Result')}${test.unit ? ` (${test.unit})` : ''}`} htmlFor="test-value">
              <Input
                id="test-value"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputMode="decimal"
                dir="ltr"
                className="font-mono"
                required
                autoFocus
              />
            </Field>
            <Field label={t('Tested on')} htmlFor="test-date">
              <Input id="test-date" name="tested_on" type="date" defaultValue={todayIso()} />
            </Field>
          </div>
          {outcome && (
            <Badge tone={outcome === 'pass' ? 'done' : 'blocked'} className="self-start">
              {outcome === 'pass' ? t('Meets the specification') : t('Outside the specification')}
            </Badge>
          )}
          <Field label={t('Lab')} htmlFor="test-lab" optional>
            <Input id="test-lab" name="lab_name" maxLength={120} defaultValue={test.lab_name ?? ''} />
          </Field>
          <Field label={t('Lab report')} optional>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" />
                {report ? t('Change file') : t('Attach PDF or photo')}
              </Button>
              {report && <span className="truncate text-[12.5px] text-ink-muted">{report.name}</span>}
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/*"
                hidden
                onChange={(event) => setReport(event.target.files?.[0] ?? null)}
              />
            </div>
          </Field>
          <Field label={t('Notes')} htmlFor="test-notes" optional>
            <Textarea id="test-notes" name="notes" maxLength={2000} className="min-h-[56px]" />
          </Field>
          <label className="flex items-start gap-2 text-[13.5px]">
            <input type="checkbox" name="raise_snag" defaultChecked className="mt-0.5 size-4 accent-accent" />
            <span>{t('Raise a snag if it fails, so somebody owns what happens next')}</span>
          </label>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save result')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A sample sent for testing. A concrete cube set is the common case: cast date plus the ages to
 * crush at (7 and 28 by default) makes one row per age, each with its own due date and target.
 */
export function NewTestDialog({ sites, fixedSiteId }: { sites: SiteOption[]; fixedSiteId?: string }) {
  const { t } = useLanguage();
  const { todayIso } = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? '');
  const [type, setType] = useState<QualityTestType>('concrete_cube');
  const [unit, setUnit] = useState<string>(QUALITY_TEST_DEFAULT_UNITS.concrete_cube);
  const [costCodeId, setCostCodeId] = useState(ANY);
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cube = type === 'concrete_cube';

  useEffect(() => {
    if (!open || !siteId) {
      setCodes([]);
      return;
    }
    let live = true;
    void costCodeOptions(siteId).then((result) => {
      if (live) setCodes(result.ok ? (result.data ?? []) : []);
    });
    setCostCodeId(ANY);
    return () => {
      live = false;
    };
  }, [open, siteId]);

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId) {
      setError(t('Choose the site'));
      return;
    }
    const specMin = read('spec_min');
    const specMax = read('spec_max');
    if ((specMin && !isQualityDecimal(specMin)) || (specMax && !isQualityDecimal(specMax))) {
      setError(t('Enter the specification as numbers, like 25'));
      return;
    }
    let ages: number[] | undefined;
    if (cube) {
      const parsed = parseCubeAges(read('ages'));
      if (!parsed) {
        setError(t('Enter up to four ages in days, like 7, 28'));
        return;
      }
      ages = parsed;
    }
    start(async () => {
      const result = await createQualityTest({
        project_id: siteId,
        test_type: type,
        title: read('title') || null,
        sample_ref: read('sample_ref'),
        location: read('location') || null,
        cost_code_id: costCodeId === ANY ? null : costCodeId,
        grade: read('grade') || null,
        cast_on: read('cast_on') || null,
        ...(ages ? { ages } : {}),
        due_on: cube ? null : read('due_on') || null,
        spec_min: specMin || null,
        spec_max: specMax || null,
        unit: unit.trim() || null,
        lab_name: read('lab_name') || null,
        notes: read('notes') || null,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the test'));
        return;
      }
      toast.success(
        result.data.items.length > 1
          ? `${result.data.items.length} ${t('tests scheduled')}`
          : t('Test scheduled'),
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <FlaskConical className="size-4" />
          {t('New test')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('New material test')}</DialogTitle>
          <DialogDescription>
            {t('A sample sent to the lab. The result is judged against the specification when it comes back.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          {!fixedSiteId && (
            <Field label={t('Site')}>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Choose a site')} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Test')}>
              <Select
                value={type}
                onValueChange={(value) => {
                  setType(value as QualityTestType);
                  setUnit(QUALITY_TEST_DEFAULT_UNITS[value as QualityTestType]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_TEST_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(QUALITY_TEST_TYPE_LABELS[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('Sample id')} htmlFor="test-sample" hint={t('As written on the sample')}>
              <Input id="test-sample" name="sample_ref" required maxLength={60} placeholder="C-14" dir="ltr" className="font-mono" />
            </Field>
          </div>
          {type === 'other' && (
            <Field label={t('What is being tested')} htmlFor="test-title">
              <Input id="test-title" name="title" required maxLength={160} placeholder={t('Fly ash bricks')} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Where it came from')} htmlFor="test-location" optional>
              <Input id="test-location" name="location" maxLength={200} placeholder={t('Block A, 2nd floor slab')} />
            </Field>
            <Field label={t('Grade')} htmlFor="test-grade" optional>
              <Input id="test-grade" name="grade" maxLength={40} placeholder="M25" dir="ltr" />
            </Field>
          </div>
          {cube ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Cast on')} htmlFor="test-cast">
                <Input id="test-cast" name="cast_on" type="date" required defaultValue={todayIso()} />
              </Field>
              <Field label={t('Crush at (days)')} htmlFor="test-ages" hint={t('One test per age, each due on its own day')}>
                <Input id="test-ages" name="ages" defaultValue="7, 28" dir="ltr" className="font-mono" />
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Sampled on')} htmlFor="test-cast" optional>
                <Input id="test-cast" name="cast_on" type="date" />
              </Field>
              <Field label={t('Result due')} htmlFor="test-due" optional>
                <Input id="test-due" name="due_on" type="date" />
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={cube ? t('28-day strength') : t('At least')}
              htmlFor="test-min"
              optional
              hint={cube ? t('Earlier ages get the usual share of it') : undefined}
            >
              <Input id="test-min" name="spec_min" inputMode="decimal" dir="ltr" className="font-mono" placeholder={cube ? '25' : ''} />
            </Field>
            <Field label={t('At most')} htmlFor="test-max" optional>
              <Input id="test-max" name="spec_max" inputMode="decimal" dir="ltr" className="font-mono" />
            </Field>
            <Field label={t('Unit')} htmlFor="test-unit" optional>
              <Input id="test-unit" value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={30} dir="ltr" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Lab')} htmlFor="test-lab-new" optional>
              <Input id="test-lab-new" name="lab_name" maxLength={120} />
            </Field>
            <Field label={t('Cost code')} optional>
              <Select value={costCodeId} onValueChange={setCostCodeId} disabled={codes.length === 0}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('None')}</SelectItem>
                  {codes.map((code) => (
                    <SelectItem key={code.id} value={code.id}>
                      {code.code} {code.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('Notes')} htmlFor="test-notes-new" optional>
            <Textarea id="test-notes-new" name="notes" maxLength={2000} className="min-h-[56px]" />
          </Field>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
