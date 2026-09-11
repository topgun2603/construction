import { inviteMessageText } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import type { Page, ProjectSummary, Role, TeamMember } from '@/lib/api-types';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { DeleteRowButton } from '@/components/delete-row-button';
import { WhatsappButton } from '@/components/whatsapp-button';
import { RolePicker } from './role-picker';
import { removeTeamMember } from '@/lib/actions';
import { requireSelf } from '@/lib/session';
import { titleCase, timeOfDay } from '@/lib/format';
import { InviteDialog } from './invite-dialog';

export const metadata = { title: 'Team · BUILDR' };

export default async function TeamPage() {
  const [team, projects, roles, me] = await Promise.all([
    serverFetch<TeamMember[]>('/tenants/current/team'),
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    serverFetch<Role[]>('/roles'),
    requireSelf(),
  ]);

  // Only an owner may remove anyone, and nobody may remove themselves — the API
  // refuses both, so the button is not offered where it would only produce an error.
  const canRemove = me.permissions.includes('team.manage');
  const ownerCount = team.filter((member) => member.role === 'owner').length;

  return (
    <FadeIn className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
          Invited people are created as pending and activate themselves the first time they sign
          in with their number — no password to send, nothing to reset.
        </p>
        <InviteDialog
          projects={projects.items}
          company={me.tenant.name}
          senderName={me.user.name}
        />
      </div>

      <Card className="divide-y divide-line-soft">
        {team.map((member) => (
          <div key={member.id} className="flex items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={member.name} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-medium">{member.name}</span>
                <span className="font-mono text-[12.5px] text-ink-muted">+{member.phone}</span>
              </div>
            </div>
            <div className="flex flex-none items-center gap-3">
              <span className="hidden text-[13px] text-ink-muted sm:inline">
                {member.last_login ? `Last seen ${timeOfDay(member.last_login)}` : 'Never signed in'}
              </span>
              {/*
                Offered to anyone who has not signed in yet — an invite nobody was told about is the
                usual reason a person is still pending a week later. It opens the sender's own
                WhatsApp; BUILDR never messages as them.
              */}
              {member.id !== me.user.id && member.status !== 'active' && (
                <WhatsappButton
                  phone={member.phone}
                  path="/login"
                  iconOnly
                  size="icon"
                  variant="ghost"
                  label={`Send ${member.name} their sign-in link on WhatsApp`}
                  message={inviteMessageText({
                    name: member.name,
                    companyName: me.tenant.name,
                    senderName: me.user.name,
                    roleLabel: titleCase(member.role),
                    siteNames: [],
                    url: '{url}',
                  })}
                />
              )}
              {canRemove && member.id !== me.user.id ? (
                <RolePicker
                  userId={member.id}
                  memberName={member.name}
                  currentRole={member.role}
                  roles={roles}
                />
              ) : (
                <span className="text-[13px] text-ink-soft">{titleCase(member.role)}</span>
              )}
              <Badge tone={member.status === 'active' ? 'done' : 'pending'}>
                {titleCase(member.status)}
              </Badge>
              {canRemove && member.id !== me.user.id && !(member.role === 'owner' && ownerCount <= 1) && (
                <DeleteRowButton
                  what={member.name}
                  title="Remove this person?"
                  body={
                    <>
                      <strong className="font-semibold text-ink">{member.name}</strong> loses access
                      immediately, on every device they are signed in on. The reports and
                      attendance they filed are kept.
                    </>
                  }
                  confirmLabel="Remove access"
                  successMessage={`${member.name} removed`}
                  onConfirm={removeTeamMember.bind(null, member.id)}
                />
              )}
            </div>
          </div>
        ))}
      </Card>
    </FadeIn>
  );
}
