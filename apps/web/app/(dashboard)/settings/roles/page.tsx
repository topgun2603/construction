import { Lock, ShieldCheck, Users } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Role } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { RoleDialog } from './role-dialog';
import { RoleActions } from './role-actions';

export const metadata = { title: 'Roles · BUILDR' };

/**
 * Roles for this tenant — the five built-in ones, plus anything the owner has invented.
 *
 * Built-in roles are shown but locked. They are the floor the product guarantees, and an
 * owner who could edit the Owner role would be able to remove their own ability to put it
 * back. Creating a role based on one is the supported way to get something narrower.
 */
export default async function RolesPage() {
  const [roles, me] = await Promise.all([
    serverFetch<Role[]>('/roles'),
    requireSelf(),
  ]);

  const canManage = me.permissions.includes('roles.manage');
  const system = roles.filter((role) => role.is_system);
  const custom = roles.filter((role) => !role.is_system);

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
          A role is a set of things somebody may do. The five built-in roles cover most
          builders; create your own when you need something they do not describe — a store
          keeper who raises indents but approves nothing, say.
        </p>
        {canManage && <RoleDialog systemRoles={system} />}
      </div>

      <section className="flex flex-col gap-2.5">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Your roles
        </span>
        {custom.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="No custom roles yet"
            body="Start from a built-in role and tick only what the job needs. People keep whatever role they are on until you move them."
            action={canManage ? <RoleDialog systemRoles={system} /> : undefined}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {custom.map((role) => (
              <RoleCard key={role.id} role={role} canManage={canManage} systemRoles={system} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Built in
        </span>
        <div className="grid gap-3 md:grid-cols-2">
          {system.map((role) => (
            <RoleCard key={role.id} role={role} canManage={false} systemRoles={system} />
          ))}
        </div>
      </section>
    </FadeIn>
  );
}

function RoleCard({
  role,
  canManage,
  systemRoles,
}: {
  role: Role;
  canManage: boolean;
  systemRoles: Role[];
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2 text-[15px] font-semibold leading-snug">
            {role.name}
            {role.is_system && (
              <span title="Built in — cannot be edited">
                <Lock className="size-3.5 text-ink-faint" />
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" />
              {role.member_count} {role.member_count === 1 ? 'person' : 'people'}
            </span>
            <span className="font-mono">{role.permissions.length} permissions</span>
            {role.sees_all_projects ? (
              <Badge tone="accent" dot={false}>
                All sites
              </Badge>
            ) : (
              <Badge tone="neutral" dot={false}>
                Assigned sites
              </Badge>
            )}
          </span>
        </div>
        {canManage && <RoleActions role={role} systemRoles={systemRoles} />}
      </div>
    </Card>
  );
}
