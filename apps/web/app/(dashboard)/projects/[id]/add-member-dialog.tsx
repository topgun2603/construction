'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { addProjectMember } from '@/lib/actions';
import type { TeamMember } from '@/lib/api-types';
import { Avatar } from '@/components/ui/avatar';
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
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { titleCase } from '@/lib/format';

/**
 * What somebody does on this particular site.
 *
 * Their account role says what they may do anywhere; this says which hat they wear here — the same
 * person can run one site and supervise another, and the wage sheet cares which.
 */
const SITE_ROLES = [
  { value: 'site_supervisor', label: 'Site supervisor' },
  { value: 'project_manager', label: 'Project manager' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'client', label: 'Client' },
  { value: 'owner', label: 'Owner' },
];

/**
 * Put an existing person on this site.
 *
 * Only people already in the account appear here. Somebody brand new is invited from Settings →
 * Team, because that creates an account and decides what they may do everywhere — a bigger decision
 * than which sites they are on, and one this dialog should not be quietly making.
 */
export function AddMemberDialog({
  projectId,
  candidates,
}: {
  projectId: string;
  /** Team members not already on this site. */
  candidates: TeamMember[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('site_supervisor');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pick(id: string) {
    setUserId(id);
    // Their account role is the likeliest answer, so the second question usually answers itself.
    const chosen = candidates.find((member) => member.id === id);
    if (chosen) setRole(chosen.role);
  }

  function onSubmit() {
    if (!userId) {
      setError('Pick somebody first');
      return;
    }
    setError(null);
    start(async () => {
      const result = await addProjectMember({ projectId, userId, roleOnProject: role });
      if (!result.ok) {
        setError(result.error ?? 'Could not add them to this site');
        return;
      }
      toast.success('Added to this site');
      setOpen(false);
      setUserId('');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <UserPlus className="size-4" /> Add someone
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add someone to this site</DialogTitle>
          <DialogDescription>
            They see this site from their next sign-in. To bring in somebody who is not in the
            account yet, invite them from Settings → Team.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-line-strong bg-raised px-4 py-5">
            <p className="text-[13.5px] text-ink-muted">
              Everybody in the account is already on this site.
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link href="/settings/team">Invite somebody new</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Who">
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-btn border border-line-strong p-2">
                {candidates.map((member) => (
                  <label
                    key={member.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-[7px] px-2 py-2 transition hover:bg-raised ${
                      userId === member.id ? 'bg-raised' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="member"
                      checked={userId === member.id}
                      onChange={() => pick(member.id)}
                      className="size-4 accent-accent"
                    />
                    <Avatar name={member.name} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] font-medium">{member.name}</span>
                      <span className="font-mono text-[12px] text-ink-muted">+{member.phone}</span>
                    </span>
                    <span className="ml-auto text-[12.5px] text-ink-faint">
                      {titleCase(member.role)}
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <Field label="On this site they are" hint="Their account role is unchanged">
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITE_ROLES.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {candidates.length > 0 && (
            <Button type="button" onClick={onSubmit} disabled={pending}>
              {pending ? 'Adding…' : 'Add to site'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
