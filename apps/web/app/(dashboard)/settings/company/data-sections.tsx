'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import {
  Download,
  ExternalLink,
  FileCheck2,
  Loader2,
  PackageOpen,
  Search,
  Trash2,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { signOut } from '@/lib/actions';
import {
  acceptDpa,
  anonymisePerson,
  dataExportDownloadUrl,
  requestCompanyDeletion,
  requestDataExport,
  searchPeople,
} from '@/lib/data-portability-actions';
import type {
  CompanyDeletionStatus,
  DataExportItem,
  DataExportList,
  LegalOverview,
  PersonSearchRow,
} from '@/lib/data-portability-types';

/**
 * Settings → Company, owner only: the data processing agreement, a full export of the company, one
 * person's data, and deleting the company. The API enforces every rule here — owner only, the daily
 * export limit, the typed name, the fresh sign-in; the screen explains them before anybody hits one.
 */
export function CompanyDataSections({
  legal,
  exports,
  deletion,
}: {
  legal: LegalOverview;
  exports: DataExportList;
  deletion: CompanyDeletionStatus;
}) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="company-data-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="company-data-heading" className="text-[17px] font-semibold">
          {t('Your data')}
        </h2>
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          {t('Take a full copy of everything your company has stored, answer a person who asks for their data, or close the company for good. Only an owner sees this, and every action is recorded in the audit log.')}
        </p>
      </header>
      <LegalCard legal={legal} />
      <ExportCard exports={exports} />
      <PeopleCard />
      <DeleteCard deletion={deletion} />
    </section>
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-pending-fg">
      {children}
    </p>
  );
}

// --- the data processing agreement -----------------------------------------------------------------

function LegalCard({ legal }: { legal: LegalOverview }) {
  const { t } = useLanguage();
  const { instantDate } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const accepted = legal.dpa.accepted;

  function accept() {
    setError(null);
    start(async () => {
      const result = await acceptDpa(legal.dpa.version);
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Agreement accepted'));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Legal')}</CardTitle>
          {accepted ? <Badge tone="done">{t('Accepted')}</Badge> : <Badge tone="pending">{t('Not yet accepted')}</Badge>}
        </div>
        <CardDescription>
          {t('The data processing agreement sets out how your company’s data is handled on its behalf. Version')}{' '}
          <span className="font-semibold text-ink">{legal.dpa.version}</span>.
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 border-t border-line-soft p-4">
        {legal.dpa.url ? (
          <a
            href={legal.dpa.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 self-start text-[13.5px] font-semibold underline underline-offset-4"
          >
            {t('Read the data processing agreement')}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : (
          <p className="text-[13px] text-ink-muted">{t('Ask your provider for the text of this version.')}</p>
        )}
        {accepted ? (
          <p className="text-[13px] text-ink-muted">
            {t('Accepted by')} <span className="font-semibold text-ink">{accepted.accepted_by_name}</span>{' '}
            {t('on')} {instantDate(accepted.accepted_at)}.
          </p>
        ) : (
          legal.dpa.can_accept && (
            <Button onClick={accept} disabled={pending} className="gap-2 self-start">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
              {t('Accept for the company')}
            </Button>
          )
        )}
        {legal.history.length > 1 && (
          <ul className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
            {legal.history.map((row) => (
              <li key={row.version}>
                {row.version} — {row.accepted_by_name}, {instantDate(row.accepted_at)}
              </li>
            ))}
          </ul>
        )}
        <FormError error={error} />
      </div>
    </Card>
  );
}

// --- full export -----------------------------------------------------------------------------------

const EXPORT_TONE: Record<DataExportItem['status'], 'done' | 'pending' | 'blocked' | 'neutral'> = {
  queued: 'pending',
  running: 'pending',
  ready: 'done',
  failed: 'blocked',
  expired: 'neutral',
};

const EXPORT_LABEL: Record<DataExportItem['status'], string> = {
  queued: 'Waiting',
  running: 'Preparing',
  ready: 'Ready',
  failed: 'Failed',
  expired: 'Expired',
};

function sizeOf(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function ExportCard({ exports }: { exports: DataExportList }) {
  const { t } = useLanguage();
  const { instantDate, timeOfDay } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function request() {
    setError(null);
    start(async () => {
      const result = await requestDataExport();
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Export started. You will get a notification when it is ready.'));
      router.refresh();
    });
  }

  async function download(id: string) {
    setError(null);
    setDownloading(id);
    const result = await dataExportDownloadUrl(id);
    setDownloading(null);
    if (!result.ok || !result.data) {
      setError(result.error ?? t('That did not work. Try again.'));
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Export all company data')}</CardTitle>
        <CardDescription>
          {t('A ZIP file with every record your company has stored (one JSON Lines file per table), a spreadsheet of the main registers — sites, workers, attendance, wages, expenses, purchase orders, subcontracts, change orders — and every photograph, document and bill uploaded. Sign-in secrets and encrypted ID numbers are left out.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 border-t border-line-soft p-4">
        <p className="text-[13px] text-ink-muted">
          {t('It is prepared in the background — a large company can take a while. The download link works for')}{' '}
          {exports.link_days} {t('days. One export a day.')}
        </p>
        {!exports.can_request && exports.blocked_reason === 'cooldown' && exports.next_allowed_at && (
          <Notice>
            {t('The next export can be asked for after')} {instantDate(exports.next_allowed_at)},{' '}
            {timeOfDay(exports.next_allowed_at)}.
          </Notice>
        )}
        <Button onClick={request} disabled={pending || !exports.can_request} className="gap-2 self-start">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <PackageOpen className="size-4" />}
          {exports.blocked_reason === 'running' ? t('Export being prepared…') : t('Export everything')}
        </Button>
        {exports.items.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-soft rounded-btn border border-line-soft">
            {exports.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[13px]">
                <Badge tone={EXPORT_TONE[item.status]}>{t(EXPORT_LABEL[item.status])}</Badge>
                <span className="text-ink">
                  {instantDate(item.created_at)}, {timeOfDay(item.created_at)}
                </span>
                {item.requested_by_name && <span className="text-ink-muted">{item.requested_by_name}</span>}
                {item.status === 'ready' && (
                  <span className="text-ink-muted">
                    {sizeOf(item.size_bytes)}
                    {item.files !== null && ` · ${item.files} ${t('files')}`}
                    {item.expires_at && ` · ${t('until')} ${instantDate(item.expires_at)}`}
                  </span>
                )}
                {item.status === 'failed' && item.error && <span className="text-blocked-fg">{item.error}</span>}
                {item.status === 'ready' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ms-auto gap-2"
                    disabled={downloading === item.id}
                    onClick={() => void download(item.id)}
                  >
                    {downloading === item.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {t('Download')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <FormError error={error} />
      </div>
    </Card>
  );
}

// --- one person's data -----------------------------------------------------------------------------

function PeopleCard() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PersonSearchRow[] | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function search(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    start(async () => {
      const result = await searchPeople(query);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      setRows(result.data.items);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('A person’s data')}</CardTitle>
        <CardDescription>
          {t('When a worker or a team member asks for the data you hold about them, download it here: their details, attendance, wages, payments, documents and every record that names them.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 border-t border-line-soft p-4">
        <Notice>
          {t('Anonymising someone who has left replaces their name, phone, ID and bank numbers and photograph, and deletes their uploaded ID documents. Their attendance, wages and payments are kept, under a placeholder name, because labour and tax law require wage records to be kept for years. Earlier audit-log entries are not rewritten. Only people who have left — an inactive or removed worker, a removed team member — can be anonymised, and it cannot be undone.')}
        </Notice>
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <Field label={t('Name or phone')} htmlFor="person-search" className="min-w-[220px] flex-1">
            <Input id="person-search" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {t('Find')}
          </Button>
        </form>
        <FormError error={error} />
        {rows && rows.length === 0 && <p className="text-[13px] text-ink-muted">{t('Nobody matches that.')}</p>}
        {rows && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-soft rounded-btn border border-line-soft">
            {rows.map((row) => (
              <PersonRow key={`${row.kind}-${row.id}`} row={row} onChanged={() => search()} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function PersonRow({ row, onChanged }: { row: PersonSearchRow; onChanged: () => void }) {
  const { t } = useLanguage();
  const href = `/settings/company/people/${row.kind}/${row.id}/export`;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[13px]">
      <span className="font-semibold text-ink">{row.name}</span>
      <Badge tone="neutral" dot={false}>
        {row.kind === 'worker' ? t('Worker') : t('Team member')}
      </Badge>
      {row.anonymised ? (
        <Badge tone="neutral">{t('Anonymised')}</Badge>
      ) : row.former ? (
        <Badge tone="pending">{t('Left')}</Badge>
      ) : null}
      {row.phone && <span className="text-ink-muted">{row.phone}</span>}
      <div className="ms-auto flex flex-wrap gap-2">
        {/* A plain link to a route that relays the ZIP: the session cookie stays httpOnly. */}
        <Button asChild size="sm" variant="secondary" className="gap-2">
          <a href={href} download>
            <Download className="size-4" />
            {t('Download data')}
          </a>
        </Button>
        {row.former && !row.anonymised && (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost" className="gap-2 text-blocked-fg">
                <UserX className="size-4" />
                {t('Anonymise')}
              </Button>
            }
            title={`${t('Anonymise')} ${row.name}?`}
            body={t('Their name, phone, ID and bank numbers, photograph and ID documents are removed for good. Attendance, wages and payments stay, under a placeholder name.')}
            confirmLabel={t('Anonymise')}
            successMessage={t('Anonymised')}
            onConfirm={async () => {
              const result = await anonymisePerson(row.kind, row.id);
              if (result.ok) onChanged();
              return result;
            }}
          />
        )}
      </div>
    </li>
  );
}

// --- deleting the company --------------------------------------------------------------------------

function DeleteCard({ deletion }: { deletion: CompanyDeletionStatus }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [confirmName, setConfirmName] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Compared trimmed, as the API does: a name copied off the page brings whitespace with it.
  const armed = confirmName.trim() === deletion.company_name.trim();
  const ready = deletion.reauth.fresh && (!deletion.mfa.required || deletion.mfa.shown);

  function remove() {
    setError(null);
    start(async () => {
      const result = await requestCompanyDeletion(confirmName.trim());
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Your company is scheduled for deletion. Everybody has been signed out.'));
      router.replace('/login');
    });
  }

  return (
    <Card className="border-blocked-fg/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Trash2 className="size-4 text-blocked-fg" aria-hidden />
          <CardTitle className="text-blocked-fg">{t('Delete this company')}</CardTitle>
        </div>
        <CardDescription>
          {t('Deletes')} {deletion.company_name}{' '}
          {t('and everything in it — sites, workers, attendance, wages, photographs and documents — after a grace period of')}{' '}
          {deletion.grace_days} {t('days. Everybody is signed out straight away and nobody but you can sign in; you can cancel at any time until then. After that it cannot be undone. Export your data first if you want to keep a copy.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 border-t border-line-soft p-4">
        {!deletion.reauth.fresh && (
          <div className="flex flex-col gap-2">
            <Notice>
              {t('For your security, sign out and sign in again, then come back here within')}{' '}
              {deletion.reauth.within_minutes} {t('minutes to delete the company.')}
            </Notice>
            <form action={signOut}>
              <Button type="submit" size="sm" variant="secondary">
                {t('Sign out to sign in again')}
              </Button>
            </form>
          </div>
        )}
        {deletion.mfa.required && !deletion.mfa.shown && (
          <Notice>{t('Your company requires two-factor authentication. Sign in with your authenticator code first.')}</Notice>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={`${t('Type the company name to confirm:')} ${deletion.company_name}`}
            htmlFor="delete-company-name"
            className="min-w-[240px] flex-1"
          >
            <Input
              id="delete-company-name"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              placeholder={deletion.company_name}
              autoComplete="off"
              disabled={!ready}
            />
          </Field>
          <div className="pb-0.5">
            <Button variant="destructive" disabled={!armed || !ready || pending} onClick={remove} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('Schedule deletion')}
            </Button>
          </div>
        </div>
        <FormError error={error} />
      </div>
    </Card>
  );
}
