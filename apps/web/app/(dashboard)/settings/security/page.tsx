import { redirect } from 'next/navigation';
import { requireSelf } from '@/lib/session';
import { serverFetch } from '@/lib/server-api';
import { getT } from '@/lib/i18n-server';
import type { SsoSettings } from '@/lib/sso-types';
import type { CompanySessions, SecuritySettings } from '@/lib/security-types';
import { FadeIn } from '@/components/motion';
import { SsoSection } from './sso-section';
import { SecurityPolicySections } from './policy-sections';

export const metadata = { title: 'Security · BUILDR' };

/**
 * Settings → Security.
 *
 * A stack of independent sections, each with its own data and forms: single sign-on, then the
 * sign-in rules — two-factor, session timeouts, the IP allow-list and who is signed in. Owner only:
 * every section here decides who can get into the company.
 */
export default async function SecuritySettingsPage() {
  const me = await requireSelf();
  if (me.user.role !== 'owner') redirect('/settings/company');
  const t = await getT();
  const [sso, security, sessions] = await Promise.all([
    serverFetch<SsoSettings>('/sso/settings'),
    serverFetch<SecuritySettings>('/security/settings'),
    serverFetch<CompanySessions>('/security/sessions'),
  ]);

  return (
    <FadeIn className="flex flex-col gap-6">
      <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
        {t('Who can get into the company, and how. Only an owner sees this page.')}
      </p>
      <SsoSection settings={sso} />
      <SecurityPolicySections settings={security} sessions={sessions} />
    </FadeIn>
  );
}
