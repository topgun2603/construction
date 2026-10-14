import Link from 'next/link';
import { ArrowRight, Building2, Trash2, X } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import {
  cancelCompanyGroupInvitation,
  leaveCompanyGroup,
  removeCompanyGroupRate,
  revokeCompanyGroupAdmin,
} from '@/lib/company-group-actions';
import type { CompanyGroupOverview } from '@/lib/company-group-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FadeIn } from '@/components/motion';
import {
  CopyCompanyId,
  CreateGroupForm,
  GrantAdminForm,
  InvitationResponse,
  InviteCompanyForm,
  RateForm,
  RenameGroupForm,
} from './group-forms';

export const metadata = { title: 'Company group · BUILDR' };

/**
 * Settings → Company group (roadmap Phase 2, module 11).
 *
 * One page for every side of it: an owner with no group starts one or answers an invitation; a
 * group admin invites companies, names admins and sets exchange rates; an owner can take the
 * company out. Everyone else sees only which group the company is in — the API sends nothing more.
 */
export default async function CompanyGroupSettingsPage() {
  const t = await getT();
  const { shortDate } = await getFormat();
  const overview = await serverFetch<CompanyGroupOverview>('/company-groups/current');
  const { company, group } = overview;
  const canManage = overview.my_permissions.includes('group.manage');
  const canView = overview.my_permissions.includes('group.view_reports');

  return (
    <FadeIn className="flex flex-col gap-4">
      <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
        {t(
          'A group joins several companies — branches, or a holding’s companies in different countries — for one consolidated report. Each company keeps its own data, team and currency; nobody gets into another company without being on its team.',
        )}
      </p>

      {overview.incoming_invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('Invitations for your company')}</CardTitle>
            <CardDescription>
              {t('Accepting puts this company’s figures in the group’s consolidated report. You can leave again at any time.')}
            </CardDescription>
          </CardHeader>
          <div className="divide-y divide-line-soft border-t border-line-soft">
            {overview.incoming_invitations.map((invitation) => (
              <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] font-medium">{invitation.group_name}</span>
                  <span className="text-[12.5px] text-ink-muted">
                    {t('Invited')} {shortDate(invitation.created_at.slice(0, 10))}
                  </span>
                </div>
                <InvitationResponse id={invitation.id} groupName={invitation.group_name ?? ''} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {!group ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('This company is not in a group')}</CardTitle>
            <CardDescription>
              {company.is_owner
                ? t('Start a group and invite your other companies, or give this company’s id to a group that wants to invite it.')
                : t('Only the company’s owner can start or join a group.')}
            </CardDescription>
          </CardHeader>
          {company.is_owner && (
            <div className="flex flex-col gap-5 border-t border-line-soft p-4">
              <CreateGroupForm defaultCurrency={company.currency} />
            </div>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>{group.name}</CardTitle>
                <CardDescription>
                  {t('Group currency')} <span className="font-mono">{group.base_currency}</span> ·{' '}
                  {overview.companies.length || '—'} {t('companies')}
                </CardDescription>
              </div>
              {canView && (
                <Button asChild variant="secondary" size="sm">
                  <Link href="/group">
                    {t('Group overview')} <ArrowRight className="rtl:rotate-180" />
                  </Link>
                </Button>
              )}
            </CardHeader>
            {canManage && (
              <div className="border-t border-line-soft p-4">
                <RenameGroupForm name={group.name} baseCurrency={group.base_currency} />
              </div>
            )}
          </Card>

          {overview.companies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('Companies')}</CardTitle>
              </CardHeader>
              <div className="divide-y divide-line-soft border-t border-line-soft">
                {overview.companies.map((member) => (
                  <div key={member.tenant_id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 flex-none items-center justify-center rounded-card bg-accent-soft text-accent">
                        <Building2 className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[15px] font-medium">{member.name}</span>
                        <span className="text-[12.5px] text-ink-muted">
                          <span className="font-mono">{member.currency}</span> · {t('Joined')}{' '}
                          {shortDate(member.joined_at.slice(0, 10))}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      {member.current && <Badge tone="accent">{t('This company')}</Badge>}
                      {member.status !== 'active' && <Badge tone="blocked">{t(member.status)}</Badge>}
                      {member.current && company.is_owner && (
                        <ConfirmDialog
                          title={t('Leave the group?')}
                          body={t(
                            'This company’s figures leave the consolidated report, and its people lose any group admin role. Nothing inside the company changes.',
                          )}
                          confirmLabel={t('Leave group')}
                          successMessage={t('Left the group')}
                          onConfirm={leaveCompanyGroup}
                          trigger={
                            <Button size="sm" variant="destructive">
                              {t('Leave')}
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle>{t('Invite a company')}</CardTitle>
                <CardDescription>
                  {t('The company joins only when its own owner accepts. Until then it sees an invitation and nothing else.')}
                </CardDescription>
              </CardHeader>
              <div className="flex flex-col gap-4 border-t border-line-soft p-4">
                <InviteCompanyForm />
                {overview.outgoing_invitations.length > 0 && (
                  <ul className="flex flex-col divide-y divide-line-soft rounded-btn border border-line">
                    {overview.outgoing_invitations.map((invitation) => (
                      <li key={invitation.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <span className="min-w-0 truncate text-[14px]">
                          {invitation.tenant_name ?? invitation.tenant_id}
                        </span>
                        <span className="flex flex-none items-center gap-2">
                          <Badge tone="pending">{t('Waiting for their owner')}</Badge>
                          <ConfirmDialog
                            title={t('Withdraw this invitation?')}
                            body={invitation.tenant_name ?? invitation.tenant_id}
                            confirmLabel={t('Withdraw')}
                            onConfirm={cancelCompanyGroupInvitation.bind(null, invitation.id)}
                            trigger={
                              <Button size="icon" variant="ghost" aria-label={t('Withdraw')} className="size-8">
                                <X />
                              </Button>
                            }
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}

          {(canManage || canView || company.is_owner) && overview.admins.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('Group admins')}</CardTitle>
                <CardDescription>
                  {t('Group admins see the consolidated report. Being one does not open any company — to work in a company, a person must be on its team.')}
                </CardDescription>
              </CardHeader>
              <div className="divide-y divide-line-soft border-t border-line-soft">
                {overview.admins.map((admin) => (
                  <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[15px] font-medium">
                        {admin.name ?? t('Removed person')}
                      </span>
                      <span className="text-[12.5px] text-ink-muted">
                        {admin.tenant_name}
                        {admin.phone ? (
                          <>
                            {' '}· <span dir="ltr" className="font-mono">+{admin.phone}</span>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex flex-none flex-wrap items-center gap-2">
                      {admin.permissions.includes('group.manage') && (
                        <Badge tone="accent">{t('Manages')}</Badge>
                      )}
                      {admin.permissions.includes('group.view_reports') && (
                        <Badge tone="neutral">{t('Sees reports')}</Badge>
                      )}
                      {!admin.active && <Badge tone="blocked">{t('Inactive')}</Badge>}
                      {canManage && (
                        <ConfirmDialog
                          title={t('Remove this group admin?')}
                          body={admin.name ?? admin.user_id}
                          confirmLabel={t('Remove')}
                          onConfirm={revokeCompanyGroupAdmin.bind(null, admin.id)}
                          trigger={
                            <Button size="icon" variant="ghost" aria-label={t('Remove')} className="size-8">
                              <Trash2 />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {canManage && (
                <div className="border-t border-line-soft p-4">
                  <GrantAdminForm companies={overview.companies} />
                </div>
              )}
            </Card>
          )}

          {(canManage || canView) && (
            <Card>
              <CardHeader>
                <CardTitle>{t('Exchange rates')}</CardTitle>
                <CardDescription>
                  {t('The group total converts each company at the rate set here for the period’s last day. Rates are typed in by the group — never fetched — so a report reads the same every time it is opened.')}
                </CardDescription>
              </CardHeader>
              <div className="flex flex-col gap-4 border-t border-line-soft p-4">
                {overview.rates.length === 0 ? (
                  <p className="text-[13.5px] text-ink-muted">
                    {t('No rates yet. Companies in another currency are left out of the group total until one is set.')}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line-soft rounded-btn border border-line">
                    {overview.rates.map((rate) => (
                      <li key={rate.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <span dir="ltr" className="font-mono text-[13.5px]">
                          1 {rate.currency} = {rate.rate} {group.base_currency}
                        </span>
                        <span className="flex flex-none items-center gap-2 text-[12.5px] text-ink-muted">
                          {t('from')} {shortDate(rate.effective_from)}
                          {canManage && (
                            <ConfirmDialog
                              title={t('Remove this rate?')}
                              body={`1 ${rate.currency} = ${rate.rate} ${group.base_currency}`}
                              confirmLabel={t('Remove')}
                              onConfirm={removeCompanyGroupRate.bind(null, rate.id)}
                              trigger={
                                <Button size="icon" variant="ghost" aria-label={t('Remove')} className="size-8">
                                  <Trash2 />
                                </Button>
                              }
                            />
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && (
                  <RateForm
                    baseCurrency={group.base_currency}
                    currencies={[...new Set(overview.companies.map((member) => member.currency))]}
                  />
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {company.is_owner && (
        <Card>
          <CardHeader>
            <CardTitle>{t('This company’s id')}</CardTitle>
            <CardDescription>
              {t('Give this to a group that wants to invite your company. It reveals nothing on its own — you still accept or decline.')}
            </CardDescription>
          </CardHeader>
          <div className="border-t border-line-soft p-4">
            <CopyCompanyId id={company.id} />
          </div>
        </Card>
      )}
    </FadeIn>
  );
}
