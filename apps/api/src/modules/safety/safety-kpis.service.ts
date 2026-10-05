import { Injectable } from '@nestjs/common';
import {
  SAFETY_CATEGORIES,
  SAFETY_CATEGORY_LABELS,
  SAFETY_INCIDENT_TYPES,
  SAFETY_INCIDENT_TYPE_LABELS,
  SAFETY_LTI_TYPES,
  SAFETY_OBSERVATION_TYPES,
  SAFETY_PERMIT_TYPE_LABELS,
  SAFETY_RECORDABLE_TYPES,
  SAFETY_SHIFT_HOURS,
  isoDateToUtcDate,
  safetyCountBy,
  safetyDaysSince,
  safetyIsLti,
  safetyIsRecordable,
  safetyLtifr,
  safetyManHours,
  safetyNumber,
  safetyOpenActionAges,
  safetyTrir,
  utcDateToIsoDate,
  type SafetyCategory,
  type SafetyExportQuery,
  type SafetyIncidentType,
  type SafetyKpiQuery,
  type SafetyPermitType,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { companyLocal, companyToday, csv, namesFor, person } from './safety-common';
import { SafetyIncidentsService } from './safety-incidents.service';
import { SafetyObservationsService } from './safety-observations.service';
import { SafetyPermitsService } from './safety-permits.service';
import { SafetyTalksService } from './safety-talks.service';

/**
 * The safety figures (roadmap Phase 2, module 8). The arithmetic lives in @sitebook/shared and is
 * unit-tested there; this gathers its inputs.
 *
 * - Man-hours come from the roll call: a shift (`SAFETY_SHIFT_HOURS`) per present day, half per
 *   half day, plus recorded overtime. There is no other source of hours worked in the product.
 * - LTIFR = lost-time injuries (fatalities included) × 1,000,000 ÷ man-hours.
 * - TRIR = recordable injuries (medical treatment, LTI, fatality) × 200,000 ÷ man-hours.
 * - Days since the last LTI count from the last one ever on the site, not only within the range;
 *   a site that never had one counts from its start date (or when it was created).
 */
@Injectable()
export class SafetyKpisService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly incidents: SafetyIncidentsService,
    private readonly observations: SafetyObservationsService,
    private readonly permits: SafetyPermitsService,
    private readonly talks: SafetyTalksService,
  ) {}

  async kpis(actor: RequestUser, query: SafetyKpiQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const today = companyToday(actor);
    const to = query.to ?? today;
    const from = query.from ?? `${to.slice(0, 4)}-01-01`;
    const range = { gte: isoDateToUtcDate(from), lte: isoDateToUtcDate(to) };
    const now = new Date();

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const projects = await tx.project.findMany({
        where: {
          deletedAt: null,
          ...(query.project_id ? { id: query.project_id } : {}),
          ...this.access.scopeFilter(actor),
        },
        select: { id: true, name: true, status: true, startDate: true, createdAt: true },
        orderBy: { name: 'asc' },
      });
      const ids = projects.map((project) => project.id);
      const inScope = { projectId: { in: ids } };

      const [roll, incidents, lastLtis, actions, observations, openObservations, permits, talks] =
        await Promise.all([
          tx.attendance.groupBy({
            by: ['projectId', 'status'],
            where: { ...inScope, attendanceDate: range },
            _count: { _all: true },
            _sum: { overtimeHours: true },
          }),
          tx.safetyIncident.findMany({
            where: { ...inScope, occurredOn: range },
            select: { projectId: true, type: true, status: true },
          }),
          tx.safetyIncident.groupBy({
            by: ['projectId'],
            where: { ...inScope, type: { in: [...SAFETY_LTI_TYPES] }, occurredOn: { lte: isoDateToUtcDate(today) } },
            _max: { occurredOn: true },
          }),
          tx.safetyAction.findMany({
            where: { ...inScope, status: 'open' },
            select: { projectId: true, status: true, raisedOn: true, dueOn: true },
          }),
          tx.safetyObservation.findMany({
            where: { ...inScope, observedOn: range },
            select: { projectId: true, type: true, category: true, status: true },
          }),
          tx.safetyObservation.groupBy({
            by: ['projectId'],
            where: { ...inScope, status: 'open' },
            _count: { _all: true },
          }),
          tx.safetyPermit.findMany({
            where: { ...inScope, status: { in: ['requested', 'active', 'suspended'] } },
            select: { projectId: true, status: true, validTo: true },
          }),
          tx.safetyToolboxTalk.count({ where: { ...inScope, talkDate: range } }),
        ]);

      const hoursFor = (projectId?: string) =>
        safetyManHours(
          roll
            .filter((row) => !projectId || row.projectId === projectId)
            .map((row) => ({
              status: row.status,
              days: row._count._all,
              overtimeHours: row._sum.overtimeHours?.toString() ?? '0',
            })),
        );
      const lastLti = new Map(
        lastLtis.map((row) => [row.projectId, row._max.occurredOn ? utcDateToIsoDate(row._max.occurredOn) : null]),
      );
      const toActionAges = (rows: typeof actions) =>
        safetyOpenActionAges(
          rows.map((row) => ({
            status: row.status,
            raisedOn: utcDateToIsoDate(row.raisedOn),
            dueOn: row.dueOn ? utcDateToIsoDate(row.dueOn) : null,
          })),
          today,
        );

      const manHours = hoursFor();
      const ltiCount = incidents.filter((row) => safetyIsLti(row.type)).length;
      const recordableCount = incidents.filter((row) => safetyIsRecordable(row.type)).length;
      const lastLtiAnywhere = [...lastLti.values()].filter(Boolean).sort().at(-1) ?? null;

      const sites = projects.map((project) => {
        const own = incidents.filter((row) => row.projectId === project.id);
        const hours = hoursFor(project.id);
        const ltis = own.filter((row) => safetyIsLti(row.type)).length;
        const recordables = own.filter((row) => safetyIsRecordable(row.type)).length;
        const last = lastLti.get(project.id) ?? null;
        const since =
          last ??
          (project.startDate ? utcDateToIsoDate(project.startDate) : companyLocal(actor, project.createdAt).slice(0, 10));
        const ownActions = toActionAges(actions.filter((row) => row.projectId === project.id));
        return {
          project_id: project.id,
          project_name: project.name,
          status: project.status,
          man_hours: hours,
          lti_count: ltis,
          recordable_count: recordables,
          ltifr: safetyLtifr(ltis, hours),
          trir: safetyTrir(recordables, hours),
          last_lti_on: last,
          has_lti: last !== null,
          // A site whose start date is still ahead has had no days yet.
          days_since_lti: since > today ? 0 : safetyDaysSince(since, today),
          open_incidents: own.filter((row) => row.status !== 'closed').length,
          open_actions: ownActions.open,
          overdue_actions: ownActions.overdue,
          open_observations: openObservations.find((row) => row.projectId === project.id)?._count._all ?? 0,
          active_permits: permits.filter((row) => row.projectId === project.id && row.status === 'active').length,
        };
      });

      const ages = toActionAges(actions);
      return {
        from,
        to,
        today,
        shift_hours: SAFETY_SHIFT_HOURS,
        man_hours: manHours,
        lti_count: ltiCount,
        recordable_count: recordableCount,
        ltifr: safetyLtifr(ltiCount, manHours),
        trir: safetyTrir(recordableCount, manHours),
        last_lti_on: lastLtiAnywhere,
        days_since_lti: lastLtiAnywhere ? safetyDaysSince(lastLtiAnywhere, today) : null,
        incidents_by_type: safetyCountBy(SAFETY_INCIDENT_TYPES, incidents.map((row) => row.type)),
        open_incidents: incidents.filter((row) => row.status !== 'closed').length,
        observations: {
          total: observations.length,
          open: observations.filter((row) => row.status === 'open').length,
          by_type: safetyCountBy(SAFETY_OBSERVATION_TYPES, observations.map((row) => row.type)),
          by_category: safetyCountBy(SAFETY_CATEGORIES, observations.map((row) => row.category)),
        },
        actions: { open: ages.open, overdue: ages.overdue, by_age: ages.buckets },
        permits: {
          requested: permits.filter((row) => row.status === 'requested').length,
          active: permits.filter((row) => row.status === 'active' && row.validTo >= now).length,
          suspended: permits.filter((row) => row.status === 'suspended').length,
          expired_open: permits.filter((row) => row.status === 'active' && row.validTo < now).length,
        },
        toolbox_talks: talks,
        definitions: {
          lti_types: SAFETY_LTI_TYPES,
          recordable_types: SAFETY_RECORDABLE_TYPES,
        },
        sites,
      };
    });
  }

  /** One sheet per kind, in the company's language of record (English) and its clock. */
  async exportCsv(actor: RequestUser, query: SafetyExportQuery): Promise<string> {
    const range = { project_id: query.project_id, from: query.from, to: query.to, limit: 500 };
    const local = (iso: string) => companyLocal(actor, new Date(iso)).replace('T', ' ');
    switch (query.kind) {
      case 'incidents': {
        const { items } = await this.incidents.list(actor, range);
        return csv([
          ['Number', 'Site', 'Occurred', 'Type', 'Severity', 'Title', 'Location', 'Injured', 'Open actions', 'Status', 'Reported by'],
          ...items.map((row) => [
            row.number,
            row.project.name,
            local(row.occurred_at),
            SAFETY_INCIDENT_TYPE_LABELS[row.type as SafetyIncidentType],
            row.severity,
            row.title,
            row.location,
            row.injured,
            row.open_actions,
            row.status,
            row.reported_by?.name,
          ]),
        ]);
      }
      case 'observations': {
        const { items } = await this.observations.list(actor, range);
        return csv([
          ['Number', 'Site', 'Observed', 'Type', 'Category', 'Severity', 'Description', 'Location', 'Status', 'Reported by'],
          ...items.map((row) => [
            row.number,
            row.project.name,
            local(row.observed_at),
            row.type,
            SAFETY_CATEGORY_LABELS[row.category as SafetyCategory] ?? row.category,
            row.severity,
            row.description,
            row.location,
            row.status,
            row.reported_by?.name,
          ]),
        ]);
      }
      case 'permits': {
        const { items } = await this.permits.list(actor, range);
        return csv([
          ['Number', 'Site', 'Type', 'Area', 'Work', 'Valid from', 'Valid to', 'Status', 'Expired', 'Crew', 'Issuer', 'Area authority'],
          ...items.map((row) => [
            row.number,
            row.project.name,
            SAFETY_PERMIT_TYPE_LABELS[row.type as SafetyPermitType],
            row.area,
            row.description,
            local(row.valid_from),
            local(row.valid_to),
            row.status,
            row.expired ? 'yes' : 'no',
            row.crew_count,
            row.issuer?.name,
            row.area_authority?.name,
          ]),
        ]);
      }
      case 'toolbox_talks': {
        const { items } = await this.talks.list(actor, range);
        return csv([
          ['Date', 'Site', 'Topic', 'Presenter', 'Minutes', 'Attendees', 'Signed'],
          ...items.map((row) => [
            row.talk_date,
            row.project.name,
            row.topic,
            row.presenter?.name,
            row.duration_minutes,
            row.attendees,
            row.signed,
          ]),
        ]);
      }
      case 'actions':
        return this.actionsCsv(actor, query);
      case 'sites': {
        const figures = await this.kpis(actor, { project_id: query.project_id, from: query.from, to: query.to });
        return csv([
          ['Site', 'Man-hours', 'LTIs', 'Recordables', 'LTIFR', 'TRIR', 'Days since LTI', 'Last LTI', 'Open incidents', 'Open actions', 'Overdue actions', 'Open observations'],
          ...figures.sites.map((site) => [
            site.project_name,
            site.man_hours,
            site.lti_count,
            site.recordable_count,
            site.ltifr,
            site.trir,
            site.days_since_lti,
            site.last_lti_on,
            site.open_incidents,
            site.open_actions,
            site.overdue_actions,
            site.open_observations,
          ]),
          ['All sites', figures.man_hours, figures.lti_count, figures.recordable_count, figures.ltifr, figures.trir, figures.days_since_lti, figures.last_lti_on, figures.open_incidents, figures.actions.open, figures.actions.overdue, figures.observations.open],
        ]);
      }
    }
  }

  private async actionsCsv(actor: RequestUser, query: SafetyExportQuery): Promise<string> {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.safetyAction.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...(query.from || query.to
            ? {
                raisedOn: {
                  ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                  ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
                },
              }
            : {}),
          project: { deletedAt: null },
        },
        include: {
          project: { select: { name: true } },
          incident: { select: { number: true } },
          observation: { select: { number: true } },
        },
        orderBy: [{ raisedOn: 'asc' }, { createdAt: 'asc' }],
        take: 2000,
      });
      const names = await namesFor(tx, rows.flatMap((row) => [row.assigneeId, row.raisedBy]));
      const today = companyToday(actor);
      return csv([
        ['Site', 'From', 'Kind', 'Action', 'Assigned to', 'Raised on', 'Due on', 'Status', 'Overdue'],
        ...rows.map((row) => {
          const due = row.dueOn ? utcDateToIsoDate(row.dueOn) : null;
          return [
            row.project.name,
            row.incident
              ? safetyNumber('INC', row.incident.number)
              : safetyNumber('OBS', row.observation?.number ?? 0),
            row.kind,
            row.description,
            person(names, row.assigneeId)?.name,
            utcDateToIsoDate(row.raisedOn),
            due,
            row.status,
            row.status === 'open' && due !== null && due < today ? 'yes' : 'no',
          ];
        }),
      ]);
    });
  }
}
