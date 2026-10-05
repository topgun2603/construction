import { serverFetch } from '@/lib/server-api';
import type { CompanySettings } from '@/lib/api-types';
import { FadeIn } from '@/components/motion';
import { requireSelf } from '@/lib/session';
import { getT } from '@/lib/i18n-server';
import { CompanyForm } from './company-form';

export const metadata = { title: 'Company · BUILDR' };

/**
 * Where the company is: country, currency, time zone, how numbers and dates read, and which tax
 * rules apply. Everything that used to be an India constant in code (roadmap Phase 0).
 *
 * Everybody can read it — a supervisor wondering why the clock says Dubai time should be able to
 * see why — but only `tenant.manage` can change it, which the API enforces as well.
 */
export default async function CompanyPage() {
  const t = await getT();
  const [company, me] = await Promise.all([
    serverFetch<CompanySettings>('/tenants/current'),
    requireSelf(),
  ]);

  return (
    <FadeIn className="flex flex-col gap-4">
      <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
        {t(
          'Where your company works. This decides the currency every amount is in, the clock that says what “today” is for attendance and reports, and how numbers and dates are written.',
        )}
      </p>
      <CompanyForm company={company} canEdit={me.permissions.includes('tenant.manage')} />
    </FadeIn>
  );
}
