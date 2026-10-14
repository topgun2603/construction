import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { requireSelf } from '@/lib/session';
import { serverFetch } from '@/lib/server-api';
import { getT } from '@/lib/i18n-server';
import type { ApiKeyList, WebhookList } from '@/lib/developer-types';
import { FadeIn } from '@/components/motion';
import { ApiKeysSection } from './api-keys-section';
import { WebhooksSection } from './webhooks-section';

export const metadata = { title: 'Developers · BUILDR' };

/**
 * Settings → Developers: API keys for the public REST API, webhook endpoints with their delivery
 * log, and the way to the API reference. Owner only — a key reads company data without anybody
 * signing in, and a webhook sends it to somebody else's server.
 */
export default async function DevelopersSettingsPage() {
  const me = await requireSelf();
  if (me.user.role !== 'owner') redirect('/settings/company');
  const t = await getT();
  const [keys, webhooks] = await Promise.all([
    serverFetch<ApiKeyList>('/developers/api-keys'),
    serverFetch<WebhookList>('/developers/webhooks'),
  ]);

  return (
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
          {t('Connect BUILDR to your accounting system, reports or client portal: API keys let your systems read your data and record expenses, and webhooks tell them the moment something happens. Only an owner sees this page, and every change here is in the audit log.')}
        </p>
        <Link
          href="/developers/docs"
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-raised"
        >
          <BookOpen className="size-4" />
          {t('API reference')}
        </Link>
      </div>
      <ApiKeysSection list={keys} />
      <WebhooksSection list={webhooks} />
    </FadeIn>
  );
}
