import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, MapPin } from 'lucide-react';
import { siteUpdateMessageText } from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type {
  Approval,
  ClientPayment,
  DailyReport,
  Material,
  PaymentSchedule,
  MaterialEstimate,
  Milestone,
  ProjectMedia,
  Page,
  MessagePerson,
  ProjectMember,
  ProjectSummary,
  SiteDocument,
  SiteMessagePage,
  TeamMember,
} from '@/lib/api-types';
import { moneyShort, shortDate, timeOfDay } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/meter';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { schedule, statusLabel, statusTone } from '@/lib/projects';
import { ProjectTabs } from './project-tabs';
import { SiteMap } from '@/components/site-map';
import { WhatsappButton } from '@/components/whatsapp-button';
import { MaterialEstimates } from './material-estimates';
import { EditSiteDialog } from './edit-site-dialog';
import { AddMemberDialog } from './add-member-dialog';
import { FileReportDialog } from './file-report-dialog';
import { ReportPhotos } from './report-photos';
import { DeleteRowButton } from '@/components/delete-row-button';
import { removeProjectMember } from '@/lib/actions';
import { SiteGallery } from './site-gallery';
import { ProjectTimeline } from './project-timeline';
import { SiteConversation } from './site-conversation';
import { PaymentScheduleTab } from './payment-schedule';
import { SiteApprovals } from './site-approvals';
import { DocumentsList } from '@/components/documents-list';

const TABS = [
  'timeline',
  'reports',
  'conversation',
  'documents',
  'approvals',
  'payments',
  'people',
  'materials',
] as const;
type TabKey = (typeof TABS)[number];

/**
 * Single project (design artboard 3b).
 *
 * The design's tab row also carries Cost. That needs the expenses module (build order step 9) — a
 * tab that opens onto an apology is worse than no tab, so the row grows as the API does.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const active: TabKey = (TABS as readonly string[]).includes(tab ?? '')
    ? (tab as TabKey)
    : 'timeline';

  let project: ProjectSummary;
  try {
    project = await serverFetch<ProjectSummary>(`/projects/${id}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  const [milestones, members, reports, media, me] = await Promise.all([
    serverFetch<Milestone[]>(`/projects/${id}/milestones`),
    serverFetch<ProjectMember[]>(`/projects/${id}/members`),
    serverFetch<Page<DailyReport>>(`/dpr?project_id=${id}&limit=30`),
    serverFetch<ProjectMedia[]>(`/projects/${id}/media`),
    // Shares the layout's `/me` rather than issuing a second one.
    requireSelf(),
  ]);

  /*
   * Estimates and the material catalogue are only fetched for the tab that shows them. They are
   * behind the `stock` module, so a Starter tenant would get a 403 — the tab is not offered to
   * them, and the fetch must not happen just because the page loaded.
   */
  const hasStock = me.enabled_modules.includes('stock');

  /*
   * The people who could be added, fetched only for the tab that offers it. `projects.manage` is
   * what both this read and the add itself require, so a supervisor looking at the same tab is not
   * asking for a list they would be refused.
   */
  const canManagePeople = me.permissions.includes('projects.manage');
  const team =
    active === 'people' && canManagePeople
      ? await serverFetch<TeamMember[]>('/tenants/current/team')
      : [];
  const [estimates, materials] =
    active === 'materials' && hasStock
      ? await Promise.all([
          serverFetch<MaterialEstimate[]>(`/stock/estimates/${id}`),
          serverFetch<Page<Material>>('/materials?limit=500'),
        ])
      : [[], { items: [], next_cursor: null } as Page<Material>];

  /*
   * The conversation and the documents, each behind its own Pro module and its own permission.
   *
   * Both are fetched only for the tab showing them. That matters more here than elsewhere: the
   * documents list is company-wide unless scoped, and asking for it on every project page load
   * would sign a URL for every drawing the account owns just to render a timeline.
   */
  const canTalk =
    me.enabled_modules.includes('client_portal') && me.permissions.includes('projects.view');
  const hasDocuments =
    me.enabled_modules.includes('documents') && me.permissions.includes('documents.view');

  /*
   * The thread itself only for the tab that shows it — but the unread count on every load.
   *
   * A badge that only appears once you are already reading the tab it points at is not a badge. The
   * count is a separate query on the API's side, so asking with `limit=1` costs one row instead of
   * a hundred and still answers "is anybody waiting on me here".
   */
  const [conversation, recipients] =
    active === 'conversation' && canTalk
      ? await Promise.all([
          serverFetch<SiteMessagePage>(`/projects/${id}/messages?limit=100`),
          serverFetch<{ items: MessagePerson[] }>(`/projects/${id}/messages/recipients`),
        ])
      : [
          canTalk
            ? await serverFetch<SiteMessagePage>(`/projects/${id}/messages?limit=1`)
            : ({
                items: [],
                unread_count: 0,
                last_read_at: null,
                next_before: null,
              } as SiteMessagePage),
          { items: [] as MessagePerson[] },
        ];

  /*
   * The client's money, and what they have been asked to sign off.
   *
   * `client_payments.view` is not the same gate as seeing the site: a supervisor is on this job and
   * records petty cash against it, and what the client owes is still none of their business. The
   * two money features in this product point in opposite directions, and the difference between
   * them is the builder's margin.
   */
  const canSeePayments =
    me.enabled_modules.includes('client_portal') &&
    me.permissions.includes('client_payments.view');
  const canManagePayments = me.permissions.includes('client_payments.manage');
  const canSeeApprovals = me.enabled_modules.includes('client_portal') && canTalk;

  // `paymentSchedule`, not `schedule`: that name is already the timeline helper from lib/projects.
  const [paymentSchedule, receipts] =
    active === 'payments' && canSeePayments
      ? await Promise.all([
          serverFetch<PaymentSchedule>(`/projects/${id}/payment-schedule`),
          serverFetch<{ items: ClientPayment[] }>(`/projects/${id}/payment-schedule/receipts`),
        ])
      : [
          {
            items: [],
            project_name: null,
            totals: {
              scheduled: '0',
              received: '0',
              outstanding: '0',
              unallocated: '0',
              budget: null,
            },
          } as PaymentSchedule,
          { items: [] as ClientPayment[] },
        ];

  /*
   * Approvals are fetched on every load, not just their own tab.
   *
   * The count is the point: somebody waiting on the client, or a client being waited on, should see
   * that from any tab. It is one small query against one project.
   */
  const approvals = canSeeApprovals
    ? (await serverFetch<{ items: Approval[] }>(`/approvals?project_id=${id}`)).items
    : [];

  /*
   * Only documents the client can already open may be attached to an approval — the API refuses
   * the rest rather than sharing them as a side effect, so the picker must not offer them either.
   */
  const shareable =
    active === 'approvals' && hasDocuments
      ? (
          await serverFetch<{ items: SiteDocument[] }>(`/documents?project_id=${id}`)
        ).items.filter((document) => document.visible_to_client)
      : [];
  const documents =
    active === 'documents' && hasDocuments
      ? (await serverFetch<{ items: SiteDocument[] }>(`/documents?project_id=${id}`)).items
      : [];

  // Mirrors the API's @Roles on the milestone routes, so the controls that appear
  // are exactly the ones that would succeed.
  const canEditTimeline = ['owner', 'project_manager'].includes(me.user.role);
  const canEditSite = me.permissions.includes('projects.manage');
  const timeline = schedule(project);
  const budget = project.budget_amount ? BigInt(project.budget_amount) : null;

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:underline"
          >
            <ArrowLeft className="size-3" /> Projects
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[21px] font-semibold leading-tight">{project.name}</h2>
            <Badge tone={statusTone(project.status)}>{statusLabel(project.status)}</Badge>
            {timeline && timeline.tone !== 'done' && (
              <Badge tone={timeline.tone}>{timeline.label}</Badge>
            )}
          </div>
          <span className="text-[13px] text-ink-muted">
            {[project.address, project.client_name].filter(Boolean).join(' · ') || 'No site details'}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-5">
          {canEditSite && <EditSiteDialog project={project} />}
          <dl className="flex gap-7 pb-1">
          <HeaderStat
            label="Schedule elapsed"
            value={timeline ? `${timeline.elapsedPercent}%` : '—'}
          />
          <HeaderStat label="Budget" value={budget === null ? '—' : moneyShort(budget.toString())} />
            <HeaderStat label="Handover" value={shortDate(project.target_end_date)} />
          </dl>
        </div>
      </div>

      <ProjectTabs
        projectId={id}
        active={active}
        reportCount={reports.items.length}
        showMaterials={hasStock}
        showConversation={canTalk}
        showDocuments={hasDocuments}
        showPayments={canSeePayments}
        showApprovals={canSeeApprovals}
        unreadCount={active === 'conversation' ? 0 : conversation.unread_count}
        pendingApprovals={approvals.filter((a) => a.status === 'pending').length}
      />

      {active === 'timeline' && (
        <div className="flex flex-col gap-4">
          {/*
            The map and the gallery sit above the timeline: somebody opening a site they have not
            visited wants to know where it is and what it looks like before what stage it is at.
          */}
          <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
            <div className="flex h-fit flex-col gap-2">
              <SiteMap
                lat={project.lat}
                lng={project.lng}
                address={project.address}
                name={project.name}
              />
              {canEditSite && (
                <div className="flex justify-end">
                  {/* Opens the same dialog as the header button — one code path writes the address. */}
                  <EditSiteDialog
                    project={project}
                    trigger={
                      <Button variant="secondary" size="sm">
                        <MapPin className="size-4" />
                        {project.lat === null ? 'Set location' : 'Move pin'}
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
            <Card className="flex flex-col gap-3 p-4">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Planned window
              </span>
              {project.start_date && project.target_end_date ? (
                <>
                  <div className="flex justify-between font-mono text-[13px] text-ink-muted">
                    <span>{shortDate(project.start_date)}</span>
                    <span>{shortDate(project.target_end_date)}</span>
                  </div>
                  <ProgressBar percent={timeline?.elapsedPercent ?? 0} />
                </>
              ) : (
                <p className="text-[13.5px] text-ink-muted">
                  No start or target date set for this site.
                </p>
              )}
            </Card>
          </div>

          <SiteGallery
            projectId={id}
            media={media}
            canEdit={me.permissions.includes('projects.manage')}
          />

          <ProjectTimeline
            projectId={id}
            milestones={milestones}
            canEdit={canEditTimeline}
          />
        </div>
      )}

      {active === 'conversation' && canTalk && (
        <SiteConversation
          projectId={id}
          messages={conversation.items}
          recipients={recipients.items}
          canPost={me.permissions.includes('messages.post')}
          canWriteInternal={me.permissions.includes('messages.internal')}
        />
      )}

      {active === 'documents' && hasDocuments && (
        <DocumentsList
          projectId={id}
          documents={documents}
          canManage={me.permissions.includes('documents.manage')}
        />
      )}

      {active === 'payments' && canSeePayments && (
        <PaymentScheduleTab
          projectId={id}
          schedule={paymentSchedule}
          receipts={receipts.items}
          milestones={milestones}
          canManage={canManagePayments}
        />
      )}

      {active === 'approvals' && canSeeApprovals && (
        <SiteApprovals
          projectId={id}
          approvals={approvals}
          sharedDocuments={shareable}
          canRequest={me.permissions.includes('approvals.request')}
          canDecide={me.permissions.includes('approvals.decide')}
        />
      )}

      {active === 'materials' && (
        <MaterialEstimates
          projectId={id}
          estimates={estimates}
          materials={materials.items}
          canEdit={me.permissions.includes('estimates.manage')}
        />
      )}

      {active === 'reports' && (
        <div className="flex flex-col gap-3">
          {me.permissions.includes('dpr.file') && (
            <div className="flex justify-end">
              <FileReportDialog projectId={id} projectName={project.name} />
            </div>
          )}
          {reports.items.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="No reports filed yet"
              body="Supervisors file the daily progress report from the mobile app. It takes about a minute."
            />
          ) : (
            reports.items.map((report) => (
              <Card key={report.id} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-[15px] font-semibold">
                      {shortDate(report.report_date)}
                    </span>
                    <span className="text-[12.5px] text-ink-muted">
                      {report.submitted_by.name}
                      {report.submitted_at && ` · ${timeOfDay(report.submitted_at)}`}
                      {report.weather && ` · ${report.weather}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-ink-muted">
                      {report.headcount} on site
                    </span>
                    <Badge tone={report.status === 'submitted' ? 'done' : 'pending'}>
                      {report.status === 'submitted' ? 'Submitted' : 'Draft'}
                    </Badge>
                  </div>
                </div>

                {report.work_done && (
                  <p className="text-[14px] leading-relaxed">{report.work_done}</p>
                )}

                {report.activities.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {report.activities.map((activity) => (
                      <li
                        key={activity.id}
                        className="rounded-full border border-line-strong px-3 py-1 text-[13px]"
                      >
                        {activity.activity}
                        {activity.quantity && (
                          <span className="ml-1.5 font-mono text-ink-muted">
                            {activity.quantity} {activity.unit ?? ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {report.photos.length > 0 && <ReportPhotos photos={report.photos} />}

                {report.issues && (
                  <p className="rounded-btn bg-blocked-bg px-3 py-2 text-[13.5px] leading-relaxed text-blocked-fg">
                    {report.issues}
                  </p>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {active === 'people' && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Assigned to this site
            </span>
            {canManagePeople && (
              <AddMemberDialog
                projectId={id}
                candidates={team.filter(
                  (person) => !members.some((member) => member.user.id === person.id),
                )}
              />
            )}
          </div>
          {members.length === 0 ? (
            <p className="text-[13.5px] text-ink-muted">
              Nobody is assigned yet. Owners and accounts see every site without being added; anybody
              else needs putting on it here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {members.map((member, index) => (
                <li
                  key={member.id}
                  className={`flex items-center justify-between gap-4 py-3 ${
                    index > 0 ? 'border-t border-line-soft' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.user.name} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[15px] font-medium">{member.user.name}</span>
                      <span className="font-mono text-[12.5px] text-ink-muted">
                        +{member.user.phone}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    <span className="text-[13px] capitalize text-ink-muted">
                      {member.role_on_project.replace(/_/g, ' ')}
                    </span>
                    {member.user.status !== 'active' && (
                      <Badge tone="pending">{member.user.status}</Badge>
                    )}
                    {/*
                      Send this person the site. For a client that is the whole product — they open
                      the link, sign in with the number the message arrived on, and see their own
                      building. The message leaves from the sender's own WhatsApp, not from BUILDR.
                    */}
                    {canManagePeople && member.user.id !== me.user.id && (
                      <DeleteRowButton
                        what={member.user.name}
                        title="Take them off this site?"
                        body={
                          <>
                            <strong className="font-semibold text-ink">{member.user.name}</strong>{' '}
                            stops seeing this site. Their account and everything they filed here are
                            kept — this is only the assignment.
                          </>
                        }
                        confirmLabel="Remove from site"
                        successMessage={`${member.user.name} removed from this site`}
                        onConfirm={removeProjectMember.bind(null, id, member.user.id)}
                      />
                    )}
                    {member.user.id !== me.user.id && (
                      <WhatsappButton
                        phone={member.user.phone}
                        path={`/projects/${id}`}
                        iconOnly
                        size="icon"
                        variant="ghost"
                        label={`Send ${member.user.name} this site on WhatsApp`}
                        message={siteUpdateMessageText({
                          name: member.user.name,
                          siteName: project.name,
                          companyName: me.tenant.name,
                          senderName: me.user.name,
                          url: '{url}',
                        })}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </FadeIn>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12.5px] leading-tight text-ink-muted">{label}</dt>
      <dd className="font-mono text-[18px] font-bold leading-[1.1]">{value}</dd>
    </div>
  );
}
