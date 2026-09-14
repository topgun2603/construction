import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { platformFetch } from '@/lib/platform-session';
import { longDate, titleCase } from '@/lib/format';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Support · BUILDR platform' };

interface SupportView {
  tenant: {
    id: string;
    name: string;
    plan: string;
    status: string;
    enabled_modules: string[];
    created_at: string;
  };
  users: {
    id: string;
    name: string;
    phone: string;
    role: string;
    custom_role_id: string | null;
    status: string;
    last_login: string | null;
  }[];
  projects: { id: string; name: string; status: string }[];
  activity: {
    since: string;
    reports: number;
    attendance_rows: number;
    indents_waiting: number;
    expenses_waiting: number;
  };
}

const STATUS_TONE: Record<string, Tone> = {
  active: 'done',
  suspended: 'blocked',
  cancelled: 'neutral',
  pending: 'pending',
};

/**
 * What an operator needs on a support call, and nothing more.
 *
 * Not impersonation. Signing in as a customer would put an operator inside their account with
 * their permissions and nothing in the tenant's own audit log to say it was not them — every
 * action would read afterwards as the customer having taken it. This answers the same questions
 * from outside: the account is suspended, the module is off the plan, or the person on the phone
 * has a role that was never given the screen they are asking about.
 *
 * Opening this page is itself recorded in the console's audit trail. Reading a customer's data is
 * an intrusion even when it is the helpful thing to do.
 */
export default async function SupportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await platformFetch<SupportView>(`/tenants/${id}/support`);
  const { tenant, users, projects, activity } = view;

  return (
    <FadeIn className="mx-auto flex max-w-[1100px] flex-col gap-5 px-6 pb-12 pt-5">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/admin/tenants/${tenant.id}`}
          className="flex w-fit items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          {tenant.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Support view</h1>
          <Badge tone={STATUS_TONE[tenant.status] ?? 'neutral'}>{titleCase(tenant.status)}</Badge>
          <Badge tone="neutral">{titleCase(tenant.plan)}</Badge>
        </div>
        <p className="text-[13px] text-ink-muted">
          Read-only. Opening this page is recorded in the audit trail.
        </p>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Reports, 14 days"
          value={String(activity.reports)}
          note={activity.reports === 0 ? 'Nothing filed — worth asking why' : 'Filed on site'}
        />
        <StatTile
          label="Attendance rows, 14 days"
          value={String(activity.attendance_rows)}
          note={activity.attendance_rows === 0 ? 'No roll call at all' : 'Marked on site'}
        />
        <StatTile
          label="Indents waiting"
          value={String(activity.indents_waiting)}
          note="Undecided"
        />
        <StatTile
          label="Expenses waiting"
          value={String(activity.expenses_waiting)}
          note="Unapproved"
        />
      </div>

      <Card className="flex flex-col">
        <div className="border-b border-line-soft px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Modules on this plan
          </span>
        </div>
        <div className="flex flex-wrap gap-2 p-4">
          {tenant.enabled_modules.length === 0 ? (
            <span className="text-[13px] text-ink-muted">None enabled</span>
          ) : (
            tenant.enabled_modules.map((module) => (
              <Badge key={module} tone="neutral">
                {titleCase(module)}
              </Badge>
            ))
          )}
        </div>
      </Card>

      <Card className="flex flex-col">
        <div className="border-b border-line-soft px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Who can sign in
          </span>
        </div>
        <ul className="divide-y divide-line-soft">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="text-[14px] font-medium">{user.name}</span>
              <span className="font-mono text-[12.5px] text-ink-muted">+{user.phone}</span>
              <Badge tone="neutral">{titleCase(user.role)}</Badge>
              {user.custom_role_id && <Badge tone="neutral">Custom role</Badge>}
              {user.status !== 'active' && (
                <Badge tone={STATUS_TONE[user.status] ?? 'neutral'}>
                  {titleCase(user.status)}
                </Badge>
              )}
              <span className="ml-auto text-[12.5px] text-ink-faint">
                {user.last_login
                  ? `Last in ${longDate(user.last_login.slice(0, 10))}`
                  : 'Never signed in'}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col">
        <div className="border-b border-line-soft px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Sites
          </span>
        </div>
        {projects.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-ink-muted">No sites on this account.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-[14px]">{project.name}</span>
                <Badge tone="neutral" className="ml-auto">
                  {titleCase(project.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </FadeIn>
  );
}
