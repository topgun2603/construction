'use client';

import { Pencil } from 'lucide-react';
import { deleteRole } from '@/lib/actions';
import type { Role } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { DeleteRowButton } from '@/components/delete-row-button';
import { RoleDialog } from './role-dialog';

/** Edit and delete for one custom role. */
export function RoleActions({ role, systemRoles }: { role: Role; systemRoles: Role[] }) {
  return (
    <div className="flex flex-none items-center gap-1">
      <RoleDialog
        role={role}
        systemRoles={systemRoles}
        trigger={
          <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${role.name}`}>
            <Pencil className="size-4" />
          </Button>
        }
      />
      <DeleteRowButton
        what={role.name}
        title="Delete this role?"
        body={
          role.member_count > 0 ? (
            <>
              <strong className="font-semibold text-ink">{role.member_count}</strong>{' '}
              {role.member_count === 1 ? 'person is' : 'people are'} on{' '}
              <strong className="font-semibold text-ink">{role.name}</strong>. Move them to
              another role first — deleting it would change their access without telling them.
            </>
          ) : (
            <>
              <strong className="font-semibold text-ink">{role.name}</strong> is removed. Nobody
              is on it, so nobody is affected.
            </>
          )
        }
        confirmLabel="Delete role"
        successMessage={`${role.name} deleted`}
        onConfirm={deleteRole.bind(null, role.id)}
      />
    </div>
  );
}
