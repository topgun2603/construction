import { FileText, Paperclip } from 'lucide-react';
import {
  RFI_DISCIPLINE_LABELS,
  RFI_PRIORITY_LABELS,
  RFI_STATUS_LABELS,
  SUBMITTAL_STATUS_LABELS,
  SUBMITTAL_TYPE_LABELS,
} from '@sitebook/shared';
import { apiFetch } from '@/lib/api';
import { createFormat, INDIA_FORMAT_LOCALE } from '@/lib/format';
import { getLanguage, getT } from '@/lib/i18n-server';
import type { ResponderFile, ResponderView } from '@/lib/rfi-types';
import { LanguageProvider } from '@/components/language-provider';
import { RespondForm } from './respond-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your reply is needed', robots: { index: false, follow: false } };

/**
 * The designer's or consultant's page, opened from a link the builder sent them (roadmap Phase 2,
 * module 9). Outside the dashboard shell entirely: no navigation, no sign-in, nothing of the
 * builder's account — one question, or one submittal revision, and a form to answer it.
 *
 * The link is the only credential, and the API holds it to the one record it names.
 */
export default async function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const t = await getT();
  const { token } = await params;

  let view: ResponderView;
  try {
    view = await apiFetch<ResponderView>(`/rfi-links/view?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
  } catch {
    // Expired, withdrawn, voided or mistyped all read the same: nothing a stranger can learn from it.
    return (
      <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-3 bg-canvas px-6 text-center">
        <h1 className="text-[20px] font-semibold">{t('This link has stopped working')}</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          {t('Links last thirty days and can be withdrawn. Ask whoever sent it for a new one.')}
        </p>
      </main>
    );
  }

  const fmt = createFormat({
    currency: view.company.currency ?? INDIA_FORMAT_LOCALE.currency,
    locale: view.company.locale ?? INDIA_FORMAT_LOCALE.locale,
    timezone: view.company.timezone ?? INDIA_FORMAT_LOCALE.timezone,
  });
  const when = (iso: string | null) => (iso ? `${fmt.instantDate(iso)}, ${fmt.timeOfDay(iso)}` : '—');

  return (
    <LanguageProvider initial={await getLanguage()}>
      <main className="mx-auto flex min-h-dvh max-w-[720px] flex-col gap-5 bg-canvas px-5 py-7">
        <header className="flex flex-col gap-1">
          <span className="text-[12.5px] uppercase tracking-[0.1em] text-ink-muted">
            {view.company.name} · {view.site.name}
          </span>
          {view.kind === 'rfi' ? (
            <>
              <h1 className="text-[24px] font-semibold leading-tight">{view.rfi.subject}</h1>
              <p className="text-[14px] text-ink-muted">
                <span className="font-mono" dir="ltr">
                  {view.rfi.label}
                </span>{' '}
                · {t(RFI_DISCIPLINE_LABELS[view.rfi.discipline])} · {t(RFI_PRIORITY_LABELS[view.rfi.priority])} ·{' '}
                {t(RFI_STATUS_LABELS[view.rfi.status])}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-[24px] font-semibold leading-tight">{view.submittal.title}</h1>
              <p className="text-[14px] text-ink-muted">
                <span className="font-mono" dir="ltr">
                  {view.submittal.label}
                </span>{' '}
                · {t(SUBMITTAL_TYPE_LABELS[view.submittal.type])} · {t(SUBMITTAL_STATUS_LABELS[view.submittal.status])}
              </p>
            </>
          )}
        </header>

        {view.kind === 'rfi' ? (
          <>
            <section className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5">
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-[14px]">
                <dt className="text-ink-muted">{t('Reply by')}</dt>
                <dd className={view.rfi.overdue ? 'font-semibold text-blocked-fg' : 'font-semibold'}>
                  {view.rfi.due_on ? fmt.shortDate(view.rfi.due_on) : '—'}
                  {view.rfi.overdue ? ` · ${t('overdue')}` : ''}
                </dd>
                <dt className="text-ink-muted">{t('Location')}</dt>
                <dd>{view.rfi.location ?? '—'}</dd>
              </dl>
              <p className="whitespace-pre-line text-[15px] leading-relaxed">{view.rfi.question}</p>
              {view.rfi.documents.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {view.rfi.documents.map((document) => (
                    <li key={`${document.title}-${document.version}`}>
                      <a
                        href={document.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-[13px] hover:bg-raised"
                      >
                        <FileText className="size-4" />
                        {document.title}
                        <span className="font-mono text-ink-faint" dir="ltr">
                          v{document.version}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <Files files={view.rfi.attachments} />
            </section>
            {view.rfi.responses.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-[15px] font-semibold">{t('Replies')}</h2>
                {view.rfi.responses.map((response) => (
                  <article key={response.id} className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4">
                    <span className="text-[12.5px] text-ink-muted">
                      <span className="font-semibold text-ink">{response.author_name}</span> · {when(response.created_at)}
                      {response.is_official ? ` · ${t('Official answer')}` : ''}
                    </span>
                    <p className="whitespace-pre-line text-[14px]">{response.body}</p>
                    <Files files={response.attachments} />
                  </article>
                ))}
              </section>
            )}
          </>
        ) : (
          <>
            <section className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[14px]">
                <dt className="text-ink-muted">{t('Review by')}</dt>
                <dd className={view.submittal.overdue ? 'font-semibold text-blocked-fg' : 'font-semibold'}>
                  {view.submittal.due_on ? fmt.shortDate(view.submittal.due_on) : '—'}
                </dd>
                <dt className="text-ink-muted">{t('Spec section')}</dt>
                <dd>{view.submittal.spec_section ?? '—'}</dd>
                <dt className="text-ink-muted">{t('Prepared by')}</dt>
                <dd>{view.submittal.submitted_by ?? view.company.name}</dd>
                <dt className="text-ink-muted">{t('Sent')}</dt>
                <dd>{when(view.submittal.submitted_at)}</dd>
              </dl>
              {view.submittal.description && (
                <p className="whitespace-pre-line text-[14px]">{view.submittal.description}</p>
              )}
              {view.submittal.note && <p className="whitespace-pre-line text-[14px]">{view.submittal.note}</p>}
              <Files files={view.submittal.files} />
            </section>
            {view.submittal.reviewed_at && (
              <section className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4 text-[14px]">
                <span className="font-semibold">
                  {t(SUBMITTAL_STATUS_LABELS[view.submittal.status])} · {view.submittal.reviewer} ·{' '}
                  {when(view.submittal.reviewed_at)}
                </span>
                {view.submittal.review_comments && (
                  <p className="whitespace-pre-line">{view.submittal.review_comments}</p>
                )}
                <Files files={view.submittal.markups} />
              </section>
            )}
          </>
        )}

        {view.can_respond ? (
          <RespondForm
            token={token}
            kind={view.kind}
            defaultName={view.kind === 'rfi' ? view.rfi.addressed_to_name : view.submittal.reviewer_name}
          />
        ) : (
          <p className="rounded-panel border border-line bg-raised p-4 text-[14px] text-ink-muted">
            {view.kind === 'rfi'
              ? t('This RFI is closed. Thank you for your answer.')
              : t('This revision has been reviewed. Thank you.')}
          </p>
        )}
      </main>
    </LanguageProvider>
  );
}

function Files({ files }: { files: ResponderFile[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.id}>
          <a
            href={file.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-[13px] hover:bg-raised"
          >
            <Paperclip className="size-4" />
            {file.filename}
          </a>
        </li>
      ))}
    </ul>
  );
}
