import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { PlanView } from '@sitebook/shared';
import { platformFetch, type PlatformTenantDetail } from '@/lib/platform-session';
import { longDate, money, shortDate, titleCase } from '@/lib/format';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { DangerZone } from './danger-zone';
import { TenantControls } from './tenant-controls';

export const metadata = { title: 'Tenant · BUILDR platform' };

const STATUS_TONE: Record<string, Tone> = {
  active: 'done',
  suspended: 'blocked',
  cancelled: 'neutral',
};

/**
 * One tenant, with the levers that change their account.
 *
 * The usage counts come first and the controls sit beside them rather than on a separate
 * screen: suspending an account is a decision that should be made while looking at how
 * much work is inside it.
 */
export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, catalogue] = await Promise.all([
    platformFetch<PlatformTenantDetail>(`/tenants/${id}`),
    platformFetch<{ items: PlanView[] }>('/plans'),
  ]);
  const { tenant, usage, team, projects, audit } = detail;

  return (
    <FadeIn className="mx-auto flex max-w-[1200px] flex-col gap-5 px-6 pb-12 pt-5">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/admin"
          className="flex w-fit items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          All tenants
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold leading-tight">{tenant.name}</h1>
          <Badge tone={STATUS_TONE[tenant.status] ?? 'neutral'}>{titleCase(tenant.status)}</Badge>
          <Badge tone={tenant.plan_expires_on === null ? 'accent' : 'neutral'} dot={false}>
            {catalogue.items.find((plan) => plan.code === tenant.plan)?.name ??
              titleCase(tenant.plan)}
          </Badge>
          {tenant.plan_standing !== 'active' && (
            <Badge tone={tenant.plan_standing === 'expired' ? 'blocked' : 'pending'}>
              {tenant.plan_standing === 'expired' ? 'Term run out — read-only' : 'In grace'}
            </Badge>
          )}
        </div>
        <span className="text-[13px] text-ink-muted">
          Joined {longDate(tenant.created_at.slice(0, 10))} ·{' '}
          {/*
            * The term, spelled out where the account is worked on. Without it an operator had to
            * open the builder's own plan page to answer "when does this run out", which is the
            * question behind most renewal calls.
            */}
          {tenant.plan_expires_on
            ? `Term ${tenant.plan_standing === 'active' ? 'runs until' : 'ended'} ${longDate(
                tenant.plan_expires_on.slice(0, 10),
              )}`
            : 'Never expires'}{' '}
          · <span className="font-mono text-[12.5px]">{tenant.id}</span>
        </span>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Sites" value={String(projects.length)} note="Not archived" />
        <StatTile label="Workers" value={String(usage.workers)} note="On the roster" />
        <StatTile
          label="Attendance rows"
          value={usage.attendance_rows.toLocaleString('en-IN')}
          note="Since they joined"
        />
        <StatTile
          label="Reports"
          value={usage.reports.toLocaleString('en-IN')}
          note={`${usage.expenses} expenses recorded`}
        />
      </div>

      <TenantControls
        tenantId={tenant.id}
        tenantName={tenant.name}
        plan={tenant.plan}
        plans={catalogue.items}
        status={tenant.status}
        enabledModules={tenant.enabled_modules}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Team
            </span>
            <span className="font-mono text-[13px] text-ink-muted">{team.length}</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {team.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] font-medium">{member.name}</span>
                  <span className="font-mono text-[12px] text-ink-muted">+{member.phone}</span>
                </div>
                <div className="flex flex-none items-center gap-2.5">
                  <span className="text-[12.5px] text-ink-soft">{titleCase(member.role)}</span>
                  <Badge tone={member.status === 'active' ? 'done' : 'pending'} dot={false}>
                    {titleCase(member.status)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Sites
            </span>
            <span className="font-mono text-[13px] text-ink-muted">{projects.length}</span>
          </div>
          {projects.length === 0 ? (
            <p className="px-4 py-5 text-[13.5px] text-ink-muted">
              No sites yet — this account signed up but never started work.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[14px] font-medium">{project.name}</span>
                    <span className="text-[12px] text-ink-muted">
                      {project.start_date
                        ? `From ${shortDate(project.start_date)}`
                        : 'No start date'}
                    </span>
                  </div>
                  <div className="flex flex-none items-center gap-2.5">
                    {project.budget_amount && (
                      <span className="font-mono text-[12.5px] text-ink-muted">
                        {money(project.budget_amount)}
                      </span>
                    )}
                    <Badge tone={project.status === 'active' ? 'done' : 'neutral'} dot={false}>
                      {titleCase(project.status)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="flex flex-col">
        <div className="border-b border-line-soft px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          What the console has done to this account
        </div>
        {audit.length === 0 ? (
          <p className="px-4 py-5 text-[13.5px] text-ink-muted">
            Nothing. No operator has changed this tenant.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {audit.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="font-mono text-[12.5px] text-ink-muted">
                  {shortDate(entry.created_at.slice(0, 10))}
                </span>
                <span className="text-[13.5px] font-medium">{entry.action}</span>
                <span className="font-mono text-[12.5px] text-ink-muted">
                  by +{entry.actor_phone}
                </span>
                <span className="font-mono text-[12px] text-ink-faint">
                  {summarise(entry.before)} → {summarise(entry.after)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DangerZone tenantId={tenant.id} tenantName={tenant.name} />
    </FadeIn>
  );
}

/** Plan and status out of an audit payload, which is the part anybody reads. */
function summarise(value: unknown): string {
  if (!value || typeof value !== 'object') return '—';
  const record = value as Record<string, unknown>;
  const parts = [record['plan'], record['status']].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '—';
}
