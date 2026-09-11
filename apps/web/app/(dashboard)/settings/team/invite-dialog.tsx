'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { inviteMessageText, toE164Indian } from '@sitebook/shared';
import { inviteTeamMember } from '@/lib/actions';
import { WhatsappButton } from '@/components/whatsapp-button';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProjectSummary } from '@/lib/api-types';

const ROLES = [
  { value: 'site_supervisor', label: 'Site supervisor', hint: 'Files reports and attendance on one or more sites' },
  { value: 'project_manager', label: 'Project manager', hint: 'Runs assigned sites and approves indents' },
  { value: 'accounts', label: 'Accounts', hint: 'Wage sheets, payments and reports across all sites' },
  { value: 'owner', label: 'Owner', hint: 'Everything, including the subscription' },
  { value: 'client', label: 'Client', hint: 'Read-only view of their own project' },
];

/** What was just created, so the dialog can offer to tell them about it. */
interface Invited {
  name: string;
  phone: string;
  roleLabel: string;
  siteNames: string[];
}

export function InviteDialog({
  projects,
  company,
  senderName,
}: {
  projects: ProjectSummary[];
  company: string;
  senderName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('site_supervisor');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<Invited | null>(null);
  const [pending, start] = useTransition();

  // Owner and accounts see every site; assigning them projects would be noise.
  const needsProjects = ['site_supervisor', 'project_manager', 'client'].includes(role);

  function onSubmit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '');
    const phone = String(formData.get('phone') ?? '');
    start(async () => {
      const result = await inviteTeamMember({
        name,
        phone,
        role,
        project_ids: needsProjects ? projectIds : [],
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not send the invite');
        return;
      }
      toast.success('Invited — they activate on first sign-in');
      /*
       * The dialog stays open on a second step rather than closing. An invite that nobody is told
       * about is a row in a table: the person waiting for access has no idea it exists, and the
       * sending is the half that is easy to forget once the form has gone.
       */
      setInvited({
        name,
        // Stored E.164 is what WhatsApp wants; the form takes ten digits.
        phone: toE164Indian(phone) ?? phone,
        roleLabel: ROLES.find((entry) => entry.value === role)?.label ?? role,
        siteNames: needsProjects
          ? projects.filter((project) => projectIds.includes(project.id)).map((p) => p.name)
          : [],
      });
      router.refresh();
    });
  }

  /** Back to an empty form, ready for the next person. */
  function reset() {
    setOpen(false);
    setInvited(null);
    setProjectIds([]);
    setError(null);
  }

  if (invited) {
    return (
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : reset())}>
        <DialogTrigger asChild>
          <Button size="sm">
            <UserPlus /> Invite
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Now tell {invited.name}</DialogTitle>
            <DialogDescription>
              BUILDR does not message people on your behalf — this opens your own WhatsApp with the
              message written, and you press send.
            </DialogDescription>
          </DialogHeader>

          <p className="whitespace-pre-wrap rounded-panel border border-line bg-raised px-3.5 py-3 text-[13.5px] leading-relaxed text-ink-muted">
            {inviteMessageText({
              name: invited.name,
              companyName: company,
              senderName,
              roleLabel: invited.roleLabel,
              siteNames: invited.siteNames,
              url: '(sign-in link)',
            })}
          </p>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={reset}>
              Later
            </Button>
            <WhatsappButton
              phone={invited.phone}
              path="/login"
              variant="primary"
              size="md"
              label={`WhatsApp ${invited.name.split(' ')[0]}`}
              message={inviteMessageText({
                name: invited.name,
                companyName: company,
                senderName,
                roleLabel: invited.roleLabel,
                siteNames: invited.siteNames,
                url: '{url}',
              })}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>{ROLES.find((r) => r.value === role)?.hint}</DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required placeholder="Suresh Babu" />
            </Field>
            <Field label="Mobile number" htmlFor="phone" hint="10 digits">
              <Input id="phone" name="phone" required inputMode="numeric" placeholder="9876543210" />
            </Field>
          </div>

          <Field label="Role">
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {needsProjects && (
            <Field label="Sites" hint="They will only see the sites you tick">
              <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-btn border border-line-strong p-2">
                {projects.length === 0 && (
                  <span className="p-2 text-[13px] text-ink-muted">No sites yet.</span>
                )}
                {projects.map((project) => (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-[14px] hover:bg-raised"
                  >
                    <input
                      type="checkbox"
                      checked={projectIds.includes(project.id)}
                      onChange={(event) =>
                        setProjectIds((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter((id) => id !== project.id),
                        )
                      }
                      className="size-4 accent-accent"
                    />
                    {project.name}
                  </label>
                ))}
              </div>
            </Field>
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Inviting…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
