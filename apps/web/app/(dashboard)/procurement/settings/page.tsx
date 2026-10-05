import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Role, TeamMember } from '@/lib/api-types';
import type { ProcurementSettings } from '@/lib/procurement-types';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { getT } from '@/lib/i18n-server';
import { getFormat } from '@/lib/format-server';
import { percent } from '../status';
import { LimitsEditor } from './limits-editor';

export const metadata = { title: 'Approval limits · BUILDR' };

/**
 * Approval limits: how much each role or person may approve on one purchase order. Owners are
 * always unlimited; anybody no limit covers approves nothing, so a new account sends every order
 * to the owner until the owner decides otherwise.
 */
export default async function ProcurementSettingsPage() {
  const t = await getT();
  const { money } = await getFormat();
  const me = await requireSelf();
  const canEdit = me.permissions.includes('tenant.manage');

  const [settings, roles, team] = await Promise.all([
    serverFetch<ProcurementSettings>('/procurement/settings'),
    canEdit ? serverFetch<Role[]>('/roles') : Promise.resolve([] as Role[]),
    canEdit ? serverFetch<TeamMember[]>('/tenants/current/team') : Promise.resolve([] as TeamMember[]),
  ]);

  return (
    <FadeIn className="flex flex-col gap-5">
      <Card className="flex flex-col gap-1 p-4 text-[13.5px]">
        <span className="font-semibold">{t('Your approval limit')}</span>
        <span className="text-ink-muted">
          {!settings.can_approve
            ? t('You do not approve purchase orders.')
            : settings.my_limit === null
              ? t('Unlimited.')
              : `${money(settings.my_limit)} ${t('per order. Orders above it go to somebody whose limit covers them.')}`}
        </span>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">{t('Who may approve how much')}</span>
          <span className="text-[13px] text-ink-muted">
            {t('Owners are unlimited. Anybody without a limit here approves nothing — their orders go to the owner. Within their own limit, an order is approved the moment it is submitted.')}
          </span>
        </div>
        {canEdit ? (
          <LimitsEditor settings={settings} roles={roles} team={team} />
        ) : (
          <div className="flex flex-col gap-2 text-[13.5px]">
            {settings.limits.length === 0 ? (
              <span className="text-ink-muted">{t('No limits set: the owner approves every order.')}</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {settings.limits.map((limit) => (
                  <li key={limit.id} className="flex justify-between gap-4">
                    <span>{limit.role_name ? `${t('Role')}: ${limit.role_name}` : limit.user_name}</span>
                    <span className="font-mono">
                      {limit.max_amount === null ? t('No limit') : money(limit.max_amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <span className="text-ink-muted">
              {t('Invoice match tolerance')}: {percent(settings.match_tolerance_bp)}
            </span>
          </div>
        )}
      </Card>
    </FadeIn>
  );
}
