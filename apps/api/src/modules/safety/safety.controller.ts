import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addSafetyPhotoSchema,
  approveSafetyPermitSchema,
  closeSafetyObservationSchema,
  createSafetyActionSchema,
  createSafetyIncidentSchema,
  createSafetyObservationSchema,
  createSafetyPermitSchema,
  createSafetyToolboxTalkSchema,
  listSafetyIncidentsQuerySchema,
  listSafetyObservationsQuerySchema,
  listSafetyPermitsQuerySchema,
  listSafetyToolboxTalksQuerySchema,
  quickSafetyObservationSchema,
  safetyCoverageQuerySchema,
  safetyExportQuerySchema,
  safetyIncidentStatusSchema,
  safetyKpiQuerySchema,
  safetyPermitNoteSchema,
  safetyRollQuerySchema,
  suggestSafetyObservationSchema,
  updateSafetyActionSchema,
  updateSafetyIncidentSchema,
  updateSafetyPermitSchema,
  type AddSafetyPhotoInput,
  type ApproveSafetyPermitInput,
  type CloseSafetyObservationInput,
  type CreateSafetyActionInput,
  type CreateSafetyIncidentInput,
  type CreateSafetyObservationInput,
  type CreateSafetyPermitInput,
  type CreateSafetyToolboxTalkInput,
  type ListSafetyIncidentsQuery,
  type ListSafetyObservationsQuery,
  type ListSafetyPermitsQuery,
  type ListSafetyToolboxTalksQuery,
  type QuickSafetyObservationInput,
  type SafetyCoverageQuery,
  type SafetyExportQuery,
  type SafetyIncidentStatusInput,
  type SafetyKpiQuery,
  type SafetyPermitNoteInput,
  type SafetyRollQuery,
  type SuggestSafetyObservationInput,
  type UpdateSafetyActionInput,
  type UpdateSafetyIncidentInput,
  type UpdateSafetyPermitInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SafetyIncidentsService } from './safety-incidents.service';
import { SafetyKpisService } from './safety-kpis.service';
import { SafetyObservationsService } from './safety-observations.service';
import { SafetyPermitsService } from './safety-permits.service';
import { SafetyTalksService } from './safety-talks.service';

/**
 * Safety (HSE), roadmap Phase 2, module 8.
 *
 * Behind `projects`, like cost codes and subcontracts: every safety record belongs to a site, and a
 * new module name would be missing from every account whose module list was stored before it.
 *
 * `safety.report` is deliberately wide — anybody on a site can report and observe. Rules that depend
 * on who is asking (the reporter correcting their own report, the assignee closing their own action,
 * the requester closing their own permit) are the services', so those routes admit either permission.
 */
@ApiTags('safety')
@RequiresModule('projects')
@Controller('safety')
export class SafetyController {
  constructor(
    private readonly incidents: SafetyIncidentsService,
    private readonly permits: SafetyPermitsService,
    private readonly talks: SafetyTalksService,
    private readonly observations: SafetyObservationsService,
    private readonly kpis: SafetyKpisService,
  ) {}

  // --- figures -----------------------------------------------------------------------------------

  @RequiresPermission('safety.view')
  @Get('kpis')
  @ApiOperation({ summary: 'Man-hours, LTIFR, TRIR, days since the last LTI, open actions, by site' })
  getKpis(@CurrentUser() user: RequestUser, @Query(zodBody(safetyKpiQuerySchema)) query: SafetyKpiQuery) {
    return this.kpis.kpis(user, query);
  }

  @RequiresPermission('safety.view')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="safety.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Incidents, observations, actions, permits, talks or site figures as CSV' })
  exportCsv(@CurrentUser() user: RequestUser, @Query(zodBody(safetyExportQuerySchema)) query: SafetyExportQuery) {
    return this.kpis.exportCsv(user, query);
  }

  // --- incidents ---------------------------------------------------------------------------------

  @RequiresPermission('safety.view')
  @Get('incidents')
  @ApiOperation({ summary: 'Incidents and near misses, newest first' })
  listIncidents(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listSafetyIncidentsQuerySchema)) query: ListSafetyIncidentsQuery,
  ) {
    return this.incidents.list(user, query);
  }

  @RequiresPermission('safety.view')
  @Get('incidents/:id')
  @ApiOperation({ summary: 'One incident: people, root cause, actions and photos' })
  getIncident(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.get(user, id);
  }

  @RequiresPermission('safety.report')
  @Post('incidents')
  @ApiOperation({ summary: 'Report an incident or near miss; an LTI or fatality alerts the owners' })
  createIncident(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createSafetyIncidentSchema)) body: CreateSafetyIncidentInput,
  ) {
    return this.incidents.create(user, body);
  }

  @RequiresPermission('safety.report', 'safety.manage')
  @Patch('incidents/:id')
  @ApiOperation({ summary: 'Correct a report, or record the investigation' })
  updateIncident(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSafetyIncidentSchema)) body: UpdateSafetyIncidentInput,
  ) {
    return this.incidents.update(user, id, body);
  }

  @RequiresPermission('safety.manage')
  @Post('incidents/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Investigate, open actions, close or reopen an incident' })
  setIncidentStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(safetyIncidentStatusSchema)) body: SafetyIncidentStatusInput,
  ) {
    return this.incidents.setStatus(user, id, body);
  }

  @RequiresPermission('safety.manage')
  @Post('incidents/:id/actions')
  @ApiOperation({ summary: 'Raise a corrective or preventive action on an incident' })
  addIncidentAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createSafetyActionSchema)) body: CreateSafetyActionInput,
  ) {
    return this.incidents.addAction(user, { incidentId: id }, body);
  }

  // --- actions and photos ------------------------------------------------------------------------

  @RequiresPermission('safety.report', 'safety.manage')
  @Patch('actions/:id')
  @ApiOperation({ summary: 'Change an action; its assignee may mark it done' })
  updateAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSafetyActionSchema)) body: UpdateSafetyActionInput,
  ) {
    return this.incidents.updateAction(user, id, body);
  }

  @RequiresPermission('safety.report')
  @Post('photos')
  @ApiOperation({ summary: 'Attach an uploaded photo to an incident, observation, permit or talk' })
  addPhoto(@CurrentUser() user: RequestUser, @Body(zodBody(addSafetyPhotoSchema)) body: AddSafetyPhotoInput) {
    return this.incidents.addPhoto(user, body);
  }

  // --- permits to work ---------------------------------------------------------------------------

  @RequiresPermission('safety.view')
  @Get('permits')
  @ApiOperation({ summary: 'Permits to work; `expired=true` for active permits past their time' })
  listPermits(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listSafetyPermitsQuerySchema)) query: ListSafetyPermitsQuery,
  ) {
    return this.permits.list(user, query);
  }

  @RequiresPermission('safety.view')
  @Get('permits/:id')
  @ApiOperation({ summary: 'One permit: checklist, crew and signatures' })
  getPermit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.permits.get(user, id);
  }

  @RequiresPermission('safety.report')
  @Post('permits')
  @ApiOperation({ summary: 'Request a permit to work' })
  createPermit(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createSafetyPermitSchema)) body: CreateSafetyPermitInput,
  ) {
    return this.permits.create(user, body);
  }

  @RequiresPermission('safety.report', 'safety.manage')
  @Patch('permits/:id')
  @ApiOperation({ summary: 'Change a requested permit; clears any signature already given' })
  updatePermit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSafetyPermitSchema)) body: UpdateSafetyPermitInput,
  ) {
    return this.permits.update(user, id, body);
  }

  @RequiresPermission('safety.manage')
  @Post('permits/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign as issuer or area authority; the second signature activates it' })
  approvePermit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(approveSafetyPermitSchema)) body: ApproveSafetyPermitInput,
  ) {
    return this.permits.approve(user, id, body);
  }

  @RequiresPermission('safety.manage')
  @Post('permits/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop work under an active permit' })
  suspendPermit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(safetyPermitNoteSchema)) body: SafetyPermitNoteInput,
  ) {
    return this.permits.suspend(user, id, body);
  }

  @RequiresPermission('safety.manage')
  @Post('permits/:id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Let work restart under a suspended permit' })
  resumePermit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.permits.resume(user, id);
  }

  @RequiresPermission('safety.report', 'safety.manage')
  @Post('permits/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hand the area back and close the permit, or withdraw a request' })
  closePermit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(safetyPermitNoteSchema.partial())) body: Partial<SafetyPermitNoteInput>,
  ) {
    return this.permits.close(user, id, body);
  }

  // --- toolbox talks -----------------------------------------------------------------------------

  @RequiresPermission('safety.report', 'safety.view')
  @Get('toolbox-talks/roll')
  @ApiOperation({ summary: 'Who was on site that day, to pick the attendees from' })
  roll(@CurrentUser() user: RequestUser, @Query(zodBody(safetyRollQuerySchema)) query: SafetyRollQuery) {
    return this.talks.roll(user, query);
  }

  @RequiresPermission('safety.view')
  @Get('toolbox-talks/coverage')
  @ApiOperation({ summary: 'Talks this week by site, and the share of the roll that heard one' })
  coverage(@CurrentUser() user: RequestUser, @Query(zodBody(safetyCoverageQuerySchema)) query: SafetyCoverageQuery) {
    return this.talks.coverage(user, query);
  }

  @RequiresPermission('safety.view')
  @Get('toolbox-talks')
  @ApiOperation({ summary: 'Toolbox talks, newest first' })
  listTalks(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listSafetyToolboxTalksQuerySchema)) query: ListSafetyToolboxTalksQuery,
  ) {
    return this.talks.list(user, query);
  }

  @RequiresPermission('safety.view')
  @Get('toolbox-talks/:id')
  @ApiOperation({ summary: 'One talk with its attendees and their sign-off' })
  getTalk(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.talks.get(user, id);
  }

  @RequiresPermission('safety.report')
  @Post('toolbox-talks')
  @ApiOperation({ summary: 'Record a toolbox talk; attendees come from that day’s roll' })
  createTalk(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createSafetyToolboxTalkSchema)) body: CreateSafetyToolboxTalkInput,
  ) {
    return this.talks.create(user, body);
  }

  @RequiresPermission('safety.report')
  @Post('toolbox-talks/:id/attendees/:workerId/sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'An attendee signs the sheet' })
  signTalk(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('workerId', ParseUUIDPipe) workerId: string,
  ) {
    return this.talks.sign(user, id, workerId);
  }

  // --- observations ------------------------------------------------------------------------------

  @RequiresPermission('safety.view')
  @Get('observations')
  @ApiOperation({ summary: 'Safety observations, newest first' })
  listObservations(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listSafetyObservationsQuerySchema)) query: ListSafetyObservationsQuery,
  ) {
    return this.observations.list(user, query);
  }

  @RequiresPermission('safety.report')
  @Post('observations/quick')
  @ApiOperation({ summary: 'A photo and a few words (or a voice note); the rest is suggested' })
  quickObservation(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(quickSafetyObservationSchema)) body: QuickSafetyObservationInput,
  ) {
    return this.observations.quick(user, body);
  }

  @RequiresPermission('safety.report')
  @Post('observations/suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suggest type, category and severity from a note; saves nothing' })
  suggest(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(suggestSafetyObservationSchema)) body: SuggestSafetyObservationInput,
  ) {
    return this.observations.suggest(user.tenantId, body.note);
  }

  @RequiresPermission('safety.view')
  @Get('observations/:id')
  @ApiOperation({ summary: 'One observation with its action and photos' })
  getObservation(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.observations.get(user, id);
  }

  @RequiresPermission('safety.report')
  @Post('observations')
  @ApiOperation({ summary: 'Record an observation, optionally with its corrective action' })
  createObservation(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createSafetyObservationSchema)) body: CreateSafetyObservationInput,
  ) {
    return this.observations.create(user, body);
  }

  @RequiresPermission('safety.manage')
  @Post('observations/:id/actions')
  @ApiOperation({ summary: 'Raise a corrective action on an observation' })
  addObservationAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createSafetyActionSchema)) body: CreateSafetyActionInput,
  ) {
    return this.incidents.addAction(user, { observationId: id }, body);
  }

  @RequiresPermission('safety.report', 'safety.manage')
  @Post('observations/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close an observation with a note and a close-out photo' })
  closeObservation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(closeSafetyObservationSchema)) body: CloseSafetyObservationInput,
  ) {
    return this.observations.close(user, id, body);
  }
}
