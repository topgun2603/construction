import { platformFetch, type PlatformTenantRow } from '@/lib/platform-session';
import { FadeIn } from '@/components/motion';
import { TenantFilters } from './tenant-filters';
import { TenantsTable } from './tenants-table';

export const metadata = { title: 'Tenants · BUILDR platform' };

/**
 * Every tenant, filterable. The analytics that frame these rows live on `/admin`; this
 * page is the list you come to once you know which account you are looking for.
 */
export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; plan?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  if (params.plan) query.set('plan', params.plan);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const list = await platformFetch<{ tenants: PlatformTenantRow[] }>(`/tenants${suffix}`);

  return (
    <FadeIn className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 pb-12 pt-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold leading-tight">Tenants</h1>
        <p className="text-[13.5px] text-ink-muted">
          {list.tenants.length} {list.tenants.length === 1 ? 'account' : 'accounts'}
          {suffix ? ' matching these filters' : ' on the platform'}.
        </p>
      </div>

      <TenantFilters
        search={params.search ?? ''}
        status={params.status ?? ''}
        plan={params.plan ?? ''}
      />

      <TenantsTable tenants={list.tenants} />
    </FadeIn>
  );
}
