'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { assignRole } from '@/lib/actions';
import type { Role } from '@/lib/api-types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Move one person onto a different role.
 *
 * Shows every role, built-in and custom, because the point of a custom role is that somebody
 * can be put on it. The current value is matched by `base_role` rather than by role id — the
 * team endpoint returns the base enum, and matching on that keeps the control honest for
 * anyone still on a built-in role.
 *
 * The API refuses to change your own role or to demote the last owner; the team page does not
 * render this control for yourself, and the refusal surfaces as a toast for the other case.
 */
export function RolePicker({
  userId,
  memberName,
  currentRole,
  roles,
}: {
  userId: string;
  memberName: string;
  currentRole: string;
  roles: Role[];
}) {
  const [pending, start] = useTransition();

  // Built-in first, then custom, matching the order the roles page uses.
  const ordered = [...roles].sort((a, b) => {
    if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const current = ordered.find((role) => role.is_system && role.base_role === currentRole);

  function change(roleId: string) {
    if (roleId === current?.id) return;
    start(async () => {
      const result = await assignRole({ userId, roleId });
      if (result.ok) {
        const role = roles.find((r) => r.id === roleId);
        toast.success(`${memberName} is now ${role?.name ?? 'on a new role'}`);
      } else {
        toast.error(result.error ?? 'Could not change the role');
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      {pending && <Loader2 className="size-3.5 animate-spin text-ink-faint" />}
      <Select value={current?.id ?? ''} onValueChange={change} disabled={pending}>
        <SelectTrigger className="h-8 w-[165px] text-[13px]" aria-label={`Role for ${memberName}`}>
          <SelectValue placeholder="Pick a role" />
        </SelectTrigger>
        <SelectContent>
          {ordered.map((role) => (
            <SelectItem key={role.id} value={role.id}>
              {role.name}
              {!role.is_system && <span className="ml-1.5 text-ink-faint">custom</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
