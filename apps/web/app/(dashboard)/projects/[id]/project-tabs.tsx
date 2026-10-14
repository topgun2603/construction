'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/components/language-provider';

export function ProjectTabs({
  projectId,
  active,
  reportCount,
  showMaterials = false,
  showConversation = false,
  showDocuments = false,
  showPayments = false,
  showApprovals = false,
  showCost = false,
  showSubcontracts = false,
  showPurchases = false,
  showChangeOrders = false,
  showQuality = false,
  showSchedule = false,
  showSafety = false,
  showBoq = false,
  showDesign = false,
  showEquipment = false,
  showMeetings = false,
  unreadCount = 0,
  pendingApprovals = 0,
}: {
  projectId: string;
  active: string;
  reportCount: number;
  /** Materials is behind the `stock` module; a tab that opens onto a 403 is worse than no tab. */
  showMaterials?: boolean;
  /** The conversation is behind `client_portal`, documents behind `documents`. Same reasoning. */
  showConversation?: boolean;
  showDocuments?: boolean;
  /**
   * Payments needs `client_payments.view`, which a supervisor does not have — what the client owes
   * is not site information. Approvals needs only to be able to see the site, because both sides
   * have to read what is waiting.
   */
  showPayments?: boolean;
  showApprovals?: boolean;
  /** Cost codes and budgets need `cost_codes.view`: what a line is priced at is the margin. */
  showCost?: boolean;
  /** Subcontracts need `subcontracts.view` or `.measure`; a supervisor measures without the money. */
  showSubcontracts?: boolean;
  /** Purchase orders need `procurement.view` or `procurement.receive`. */
  showPurchases?: boolean;
  /** Change orders: `change_orders.view` for the team; a client sees theirs through approvals. */
  showChangeOrders?: boolean;
  /** Quality needs `quality.view` or `.inspect`; a client gets it for their punch list. */
  showQuality?: boolean;
  /** The Gantt needs `schedule.view`. */
  showSchedule?: boolean;
  /** Safety needs `safety.view`; anybody who can only report does it from the company page. */
  showSafety?: boolean;
  /** The bill of quantities needs `boq.view`, `boq.measure` or `boq.bill`. */
  showBoq?: boolean;
  /** RFIs and submittals together: `rfis.view` or `submittals.view`. */
  showDesign?: boolean;
  /** Equipment needs `equipment.view`, `.log` or `.manage`; the cost on it needs `.view`. */
  showEquipment?: boolean;
  /** Site meetings need `meetings.view`. */
  showMeetings?: boolean;
  unreadCount?: number;
  pendingApprovals?: number;
}) {
  const { t } = useLanguage();

  /*
   * Seventeen tabs in one row stopped being a tab bar and became a sentence to read. They are
   * grouped the way the people using them think about a site: the day-to-day work, what is agreed
   * with the client, the money, and quality and safety. The URLs are unchanged — each tab is still
   * `?tab=<key>` — so links, bookmarks and the page that reads them need not know about groups.
   * A group shows only when the reader can open at least one tab in it.
   */
  const groups: { key: string; label: string; tabs: Tab[] }[] = [
    {
      key: 'site',
      label: t('Site work'),
      tabs: [
        { key: 'timeline', label: t('Timeline') },
        ...(showSchedule ? [{ key: 'schedule', label: t('Schedule') }] : []),
        { key: 'reports', label: t('Daily reports'), count: reportCount },
        { key: 'people', label: t('People') },
        ...(showMaterials ? [{ key: 'materials', label: t('Materials') }] : []),
        ...(showEquipment ? [{ key: 'equipment', label: t('Equipment') }] : []),
      ],
    },
    {
      key: 'client',
      label: t('Client & documents'),
      tabs: [
        ...(showConversation
          ? [{ key: 'conversation', label: t('Conversation'), count: unreadCount, alert: true }]
          : []),
        ...(showApprovals
          ? [{ key: 'approvals', label: t('Approvals'), count: pendingApprovals, alert: true }]
          : []),
        ...(showDocuments ? [{ key: 'documents', label: t('Documents') }] : []),
        ...(showDesign ? [{ key: 'design', label: t('RFIs & submittals') }] : []),
        ...(showMeetings ? [{ key: 'meetings', label: t('Meetings') }] : []),
      ],
    },
    {
      key: 'money',
      label: t('Money'),
      tabs: [
        ...(showCost ? [{ key: 'cost', label: t('Cost codes') }] : []),
        ...(showBoq ? [{ key: 'boq', label: t('BOQ') }] : []),
        ...(showPurchases ? [{ key: 'purchases', label: t('Purchases') }] : []),
        ...(showSubcontracts ? [{ key: 'subcontracts', label: t('Subcontracts') }] : []),
        ...(showChangeOrders ? [{ key: 'change-orders', label: t('Change orders') }] : []),
        ...(showPayments ? [{ key: 'payments', label: t('Payments') }] : []),
      ],
    },
    {
      key: 'quality',
      label: t('Quality & safety'),
      tabs: [
        ...(showQuality ? [{ key: 'quality', label: t('Quality') }] : []),
        ...(showSafety ? [{ key: 'safety', label: t('Safety') }] : []),
      ],
    },
  ].filter((group) => group.tabs.length > 0);

  const current = groups.find((group) => group.tabs.some((tab) => tab.key === active)) ?? groups[0];
  const href = (key: string) => `/projects/${projectId}?tab=${key}`;

  return (
    <nav aria-label={t('Site sections')} className="flex flex-col gap-1">
      {/* One group is just tabs; a heading row for a single heading would only cost a line. */}
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map((group) => {
            const selected = group.key === current?.key;
            // Only what is waiting for somebody is summed onto a group: unread messages and
            // approvals. The report count is a total, not a call to act.
            const waiting = group.tabs.reduce(
              (sum, tab) => sum + (tab.alert && tab.count ? tab.count : 0),
              0,
            );
            return (
              <Link
                key={group.key}
                href={href(group.tabs[0]!.key)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex min-h-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                  selected
                    ? 'bg-ink text-surface'
                    : 'bg-neutral-bg text-ink-soft hover:bg-raised hover:text-ink',
                )}
              >
                {group.label}
                {waiting > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 font-mono text-[11px]',
                      selected ? 'bg-surface/20 text-surface' : 'bg-accent text-white',
                    )}
                  >
                    {waiting}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {current?.tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={href(tab.key)}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-2 border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] leading-tight transition',
                selected
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent font-medium text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className="rounded-full bg-neutral-bg px-1.5 font-mono text-[11px] text-ink-soft">
                  {tab.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

interface Tab {
  key: string;
  label: string;
  count?: number;
  /** A count that means something is waiting — summed onto the group heading. */
  alert?: boolean;
}
