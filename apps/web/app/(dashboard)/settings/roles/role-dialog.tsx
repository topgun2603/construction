'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSION_GROUPS, SYSTEM_ROLE_NOTES, type Permission } from '@sitebook/shared';
import { createRole, updateRole } from '@/lib/actions';
import type { Role } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Create or edit a role.
 *
 * Starting from a built-in role is not decoration: `base_role` decides how the person is
 * treated where permissions cannot reach — which role they hold on a project, and the
 * approver identity checks inside the services. Picking it first also means the permission
 * list arrives pre-ticked with something sensible rather than empty, which is the difference
 * between "tick twelve boxes" and "untick two".
 *
 * Owner is not offered as a base. A role based on owner would be a second administrator
 * wearing a narrower name, and the API refuses it too.
 */
const BASE_ROLES = [
  { value: 'project_manager', label: 'Project manager' },
  { value: 'site_supervisor', label: 'Site supervisor' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'client', label: 'Client' },
] as const;

export function RoleDialog({
  systemRoles,
  role,
  trigger,
}: {
  /** Used to pre-tick the permissions of whichever base role is chosen. */
  systemRoles: Role[];
  /** Present when editing, absent when creating. */
  role?: Role;
  trigger?: ReactNode;
}) {
  const editing = Boolean(role);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? '');
  const [base, setBase] = useState<string>(role?.base_role ?? 'site_supervisor');
  const [seesAll, setSeesAll] = useState(role?.sees_all_projects ?? false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Switching base re-seeds the ticks — only while creating, never while editing. */
  function pickBase(next: string) {
    setBase(next);
    if (editing) return;
    const preset = systemRoles.find((r) => r.base_role === next);
    setChosen(new Set(preset?.permissions ?? []));
    setSeesAll(preset?.sees_all_projects ?? false);
  }

  function toggle(permission: Permission) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Give the role a name');
      return;
    }
    if (chosen.size === 0) {
      setError('Tick at least one thing this role can do');
      return;
    }

    start(async () => {
      const permissions = [...chosen];
      const result =
        editing && role
          ? await updateRole({
              id: role.id,
              name: name.trim(),
              permissions,
              sees_all_projects: seesAll,
            })
          : await createRole({
              name: name.trim(),
              base_role: base,
              permissions,
              sees_all_projects: seesAll,
            });

      if (!result.ok) {
        setError(result.error ?? 'That did not work');
        return;
      }
      toast.success(editing ? `${name.trim()} updated` : `${name.trim()} created`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-4" />
            New role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${role?.name}` : 'New role'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes apply to everyone on this role on their next action.'
              : 'Start from the role this job most resembles, then tick only what it needs.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto pr-1">
          <Field label="Name" hint="What you would call this job on site">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Store keeper"
              maxLength={60}
              autoFocus
            />
          </Field>

          {!editing && (
            <Field label="Based on" hint={SYSTEM_ROLE_NOTES[base as never] ?? ''}>
              <div className="flex flex-wrap gap-1.5">
                {BASE_ROLES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => pickBase(option.value)}
                    aria-pressed={base === option.value}
                    className={cn(
                      'min-h-0 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition',
                      base === option.value
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line-strong bg-surface text-ink-soft hover:text-ink',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-btn bg-raised p-3">
            <input
              type="checkbox"
              checked={seesAll}
              onChange={(event) => setSeesAll(event.target.checked)}
              className="mt-0.5 size-4 accent-accent"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-medium">Sees every site</span>
              <span className="text-[12.5px] leading-snug text-ink-muted">
                Off means they see only sites they are assigned to. Leave it off unless the job
                genuinely spans the whole company — it is the difference between a supervisor and
                an auditor.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-3">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.group} className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {group.group}
                </span>
                <div className="flex flex-col gap-1">
                  {group.items.map((item) => (
                    <label
                      key={item.permission}
                      className="flex cursor-pointer items-start gap-2.5 rounded-btn px-2 py-1.5 hover:bg-raised"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.has(item.permission)}
                        onChange={() => toggle(item.permission)}
                        className="mt-0.5 size-4 accent-accent"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[13.5px] leading-snug">{item.label}</span>
                        {item.note && (
                          <span className="text-[12px] leading-snug text-ink-muted">
                            {item.note}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <span className="mr-auto self-center font-mono text-[12.5px] text-ink-muted">
            {chosen.size} selected
          </span>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? 'Save role' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
