import Link from 'next/link';
import {
  QUALITY_TEST_TYPE_LABELS,
  qualitySpecLabel,
  type QualitySummaryReport,
} from '@sitebook/shared';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { StatTile } from '@/components/stat-tile';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportMenu } from '@/components/export-menu';
import { filterQuery, passRate } from './labels';

/**
 * The quality summary (what a QA manager reports upward): where open snags sit and how old they
 * are, which checklists and sites fail most, and which tests failed. Each block is a small table
 * rather than a chart — the numbers are few, and the question is always "which one", not "what
 * shape".
 */
export async function QualityReportsView({
  report,
  filters,
}: {
  report: QualitySummaryReport;
  filters: { project_id?: string; from?: string; to?: string };
}) {
  const t = await getT();
  const { shortDate } = await getFormat();
  const { snags, inspections, tests } = report;
  const exportHref = (kind: string) => `/quality/export?${filterQuery({ kind, ...filters })}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('Open snags')}
          value={String(snags.open)}
          animate
          noteTone={snags.overdue > 0 ? 'blocked' : 'done'}
          note={snags.overdue > 0 ? `${snags.overdue} ${t('overdue')}` : t('None overdue')}
        />
        <StatTile
          label={t('Fixed, to check')}
          value={String(snags.fixed)}
          animate
          noteTone={snags.fixed > 0 ? 'pending' : 'neutral'}
          note={`${snags.closed} ${t('closed')}`}
        />
        <StatTile
          label={t('Inspection pass rate')}
          value={passRate(inspections.pass_rate_bp)}
          note={`${inspections.completed} ${t('completed')} · ${inspections.failed} ${t('failed')}`}
          noteTone={inspections.failed > 0 ? 'pending' : 'neutral'}
        />
        <StatTile
          label={t('Test failures')}
          value={String(tests.failed)}
          animate
          noteTone={tests.failed > 0 ? 'blocked' : 'done'}
          note={`${tests.pending} ${t('pending')} · ${tests.overdue} ${t('overdue at the lab')}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {t('Export CSV')}
        </span>
        {(
          [
            ['snags', 'snags', 'Snags'],
            ['inspections', 'inspections', 'Inspections'],
            ['tests', 'quality_tests', 'Tests'],
          ] as const
        ).map(([kind, excelKind, label]) => (
          // Excel through the shared export; the CSV stays the register's own.
          <ExportMenu
            key={kind}
            kind={excelKind}
            filters={Object.fromEntries(new URLSearchParams(filterQuery(filters)))}
            csvHref={exportHref(kind)}
            label={t(label)}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title={t('Open snags by site')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Site')}</TableHead>
                <TableHead className="text-end">{t('Open')}</TableHead>
                <TableHead className="text-end">{t('Fixed')}</TableHead>
                <TableHead className="text-end">{t('Overdue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snags.by_site.map((row) => (
                <TableRow key={row.project.id}>
                  <TableCell>
                    <Link href={`/quality?${filterQuery({ tab: 'snags', project_id: row.project.id })}`} className="hover:underline">
                      {row.project.name}
                    </Link>
                  </TableCell>
                  <Num value={row.open} />
                  <Num value={row.fixed} />
                  <Num value={row.overdue} alert />
                </TableRow>
              ))}
              <EmptyRow show={snags.by_site.length === 0} span={4} text={t('No open snags.')} />
            </TableBody>
          </Table>
        </Block>

        <Block title={t('Open snags by trade')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Trade')}</TableHead>
                <TableHead className="text-end">{t('Open')}</TableHead>
                <TableHead className="text-end">{t('Fixed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snags.by_trade.map((row) => (
                <TableRow key={row.trade}>
                  <TableCell>{row.trade ? t(row.trade) : t('No trade')}</TableCell>
                  <Num value={row.open} />
                  <Num value={row.fixed} />
                </TableRow>
              ))}
              <EmptyRow show={snags.by_trade.length === 0} span={3} text={t('No open snags.')} />
            </TableBody>
          </Table>
        </Block>

        <Block title={t('Open snags by assignee')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Given to')}</TableHead>
                <TableHead className="text-end">{t('Open')}</TableHead>
                <TableHead className="text-end">{t('Overdue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snags.by_assignee.map((row) => (
                <TableRow key={`${row.kind}:${row.name}`}>
                  <TableCell>
                    {row.kind === 'none' ? t('Nobody yet') : row.name}
                    {row.kind === 'contractor' && (
                      <span className="ms-1.5 text-[12px] text-ink-muted">{t('Contractor')}</span>
                    )}
                  </TableCell>
                  <Num value={row.open} />
                  <Num value={row.overdue} alert />
                </TableRow>
              ))}
              <EmptyRow show={snags.by_assignee.length === 0} span={3} text={t('No open snags.')} />
            </TableBody>
          </Table>
        </Block>

        <Block title={t('How long they have been open')}>
          <Table>
            <TableBody>
              {snags.by_age.map((row) => (
                <TableRow key={row.bucket}>
                  <TableCell>{t(row.label)}</TableCell>
                  <Num value={row.count} alert={row.bucket === '31+'} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Block>

        <Block title={t('Inspection pass rate by checklist')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Checklist')}</TableHead>
                <TableHead className="text-end">{t('Completed')}</TableHead>
                <TableHead className="text-end">{t('Failed')}</TableHead>
                <TableHead className="text-end">{t('Pass rate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.by_template.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>{row.name}</TableCell>
                  <Num value={row.completed} />
                  <Num value={row.failed} alert />
                  <TableCell className="text-end font-mono">{passRate(row.pass_rate_bp)}</TableCell>
                </TableRow>
              ))}
              <EmptyRow show={inspections.by_template.length === 0} span={4} text={t('No inspections completed yet.')} />
            </TableBody>
          </Table>
        </Block>

        <Block title={t('Inspection pass rate by site')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Site')}</TableHead>
                <TableHead className="text-end">{t('Completed')}</TableHead>
                <TableHead className="text-end">{t('Failed')}</TableHead>
                <TableHead className="text-end">{t('Pass rate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.by_site.map((row) => (
                <TableRow key={row.project.id}>
                  <TableCell>{row.project.name}</TableCell>
                  <Num value={row.completed} />
                  <Num value={row.failed} alert />
                  <TableCell className="text-end font-mono">{passRate(row.pass_rate_bp)}</TableCell>
                </TableRow>
              ))}
              <EmptyRow show={inspections.by_site.length === 0} span={4} text={t('No inspections completed yet.')} />
            </TableBody>
          </Table>
        </Block>
      </div>

      <Block title={t('Failed tests')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Sample')}</TableHead>
              <TableHead>{t('Site')}</TableHead>
              <TableHead>{t('Tested')}</TableHead>
              <TableHead className="text-end">{t('Result')}</TableHead>
              <TableHead className="text-end">{t('Specification')}</TableHead>
              <TableHead>{t('Snag')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tests.failures.map((test) => (
              <TableRow key={test.id}>
                <TableCell>
                  <span className="font-mono" dir="ltr">
                    {test.sample_ref}
                  </span>
                  {test.age_days ? ` · ${test.age_days} ${t('days')}` : ''}
                  <div className="text-[12px] text-ink-muted">
                    {test.title ?? t(QUALITY_TEST_TYPE_LABELS[test.test_type])}
                  </div>
                </TableCell>
                <TableCell>{test.project.name}</TableCell>
                <TableCell className="font-mono">{shortDate(test.tested_on)}</TableCell>
                <TableCell className="text-end font-mono text-blocked-fg" dir="ltr">
                  {test.result_value} {test.unit ?? ''}
                </TableCell>
                <TableCell className="text-end font-mono" dir="ltr">
                  {qualitySpecLabel({ min: test.spec_min, max: test.spec_max }, test.unit)}
                </TableCell>
                <TableCell>
                  {test.snag ? (
                    <Link href={`/quality/snags/${test.snag.id}`} className="text-accent hover:underline">
                      #{test.snag.number}
                    </Link>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
            <EmptyRow show={tests.failures.length === 0} span={6} text={t('No failed tests.')} />
          </TableBody>
        </Table>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="border-b border-line-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {title}
      </div>
      <div className="px-1 pb-1">{children}</div>
    </Card>
  );
}

function Num({ value, alert = false }: { value: number; alert?: boolean }) {
  return (
    <TableCell className={`text-end font-mono ${alert && value > 0 ? 'font-semibold text-blocked-fg' : ''}`}>
      {value}
    </TableCell>
  );
}

function EmptyRow({ show, span, text }: { show: boolean; span: number; text: string }) {
  if (!show) return null;
  return (
    <TableRow>
      <TableCell colSpan={span} className="py-4 text-center text-ink-muted">
        {text}
      </TableCell>
    </TableRow>
  );
}
