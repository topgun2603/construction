import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createScheduleBaselineSchema,
  createScheduleDependencySchema,
  createScheduleTaskSchema,
  scheduleCalendarSchema,
  scheduleImportPreviewSchema,
  scheduleImportSchema,
  scheduleLookAheadQuerySchema,
  scheduleProgressSchema,
  scheduleQuerySchema,
  updateScheduleDependencySchema,
  updateScheduleTaskSchema,
  type CreateScheduleBaselineInput,
  type CreateScheduleDependencyInput,
  type CreateScheduleTaskInput,
  type ScheduleCalendarInput,
  type ScheduleImportInput,
  type ScheduleImportPreviewInput,
  type ScheduleLookAheadQuery,
  type ScheduleProgressInput,
  type ScheduleQuery,
  type UpdateScheduleDependencyInput,
  type UpdateScheduleTaskInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ScheduleBaselinesService } from './schedule-baselines.service';
import { ScheduleImportService } from './schedule-import.service';
import { SchedulingService } from './scheduling.service';

/**
 * Scheduling (roadmap Phase 2, module 6).
 *
 * Behind `projects`, like cost codes and subcontracts: a schedule is part of a site, and a new
 * module name would be missing from every account whose module list was stored before it existed.
 *
 * Reading is `schedule.view`. Progress — percent complete and actual dates — is `schedule.progress`
 * or `manage`, so a supervisor reports from site without being able to move the plan.
 */
@ApiTags('schedule')
@RequiresModule('projects')
@Controller()
export class SchedulingController {
  constructor(
    private readonly schedule: SchedulingService,
    private readonly baselines: ScheduleBaselinesService,
    private readonly imports: ScheduleImportService,
  ) {}

  @RequiresPermission('schedule.view')
  @Get('projects/:id/schedule')
  @ApiOperation({ summary: 'The site schedule, worked out: dates, float, critical path, baselines' })
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodBody(scheduleQuerySchema)) query: ScheduleQuery,
  ) {
    return this.schedule.get(user, id, query);
  }

  // --- tasks -------------------------------------------------------------------------------------

  @RequiresPermission('schedule.manage')
  @Post('projects/:id/schedule/tasks')
  @ApiOperation({ summary: 'Add a task or milestone' })
  createTask(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createScheduleTaskSchema)) body: CreateScheduleTaskInput,
  ) {
    return this.schedule.createTask(user, id, body);
  }

  @RequiresPermission('schedule.manage')
  @Patch('projects/:id/schedule/tasks/:taskId')
  @ApiOperation({ summary: 'Edit a task: its plan, its place in the breakdown, or its progress' })
  updateTask(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(zodBody(updateScheduleTaskSchema)) body: UpdateScheduleTaskInput,
  ) {
    return this.schedule.updateTask(user, id, taskId, body);
  }

  @RequiresPermission('schedule.progress', 'schedule.manage')
  @Post('projects/:id/schedule/tasks/:taskId/progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report progress: percent complete, actual start and finish' })
  progress(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(zodBody(scheduleProgressSchema)) body: ScheduleProgressInput,
  ) {
    return this.schedule.recordProgress(user, id, taskId, body);
  }

  @RequiresPermission('schedule.manage')
  @Delete('projects/:id/schedule/tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a task and everything under it' })
  async deleteTask(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<void> {
    await this.schedule.deleteTask(user, id, taskId);
  }

  @RequiresPermission('schedule.manage')
  @Post('projects/:id/schedule/milestones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put the site milestones that are not on the schedule onto it' })
  addMilestones(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.addMilestones(user, id);
  }

  // --- links -------------------------------------------------------------------------------------

  @RequiresPermission('schedule.manage')
  @Post('projects/:id/schedule/dependencies')
  @ApiOperation({ summary: 'Link two tasks; a link that would make a loop is refused' })
  createDependency(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createScheduleDependencySchema)) body: CreateScheduleDependencyInput,
  ) {
    return this.schedule.createDependency(user, id, body);
  }

  @RequiresPermission('schedule.manage')
  @Patch('projects/:id/schedule/dependencies/:dependencyId')
  @ApiOperation({ summary: 'Change a link’s type or lag' })
  updateDependency(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
    @Body(zodBody(updateScheduleDependencySchema)) body: UpdateScheduleDependencyInput,
  ) {
    return this.schedule.updateDependency(user, id, dependencyId, body);
  }

  @RequiresPermission('schedule.manage')
  @Delete('projects/:id/schedule/dependencies/:dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a link' })
  async deleteDependency(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
  ): Promise<void> {
    await this.schedule.deleteDependency(user, id, dependencyId);
  }

  // --- calendars ---------------------------------------------------------------------------------

  @RequiresPermission('schedule.view')
  @Get('projects/:id/schedule/calendar')
  @ApiOperation({ summary: 'The working calendar the site is scheduled on' })
  siteCalendar(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.siteCalendar(user, id);
  }

  @RequiresPermission('schedule.manage')
  @Put('projects/:id/schedule/calendar')
  @ApiOperation({ summary: 'Give the site its own working week and holidays' })
  setSiteCalendar(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(scheduleCalendarSchema)) body: ScheduleCalendarInput,
  ) {
    return this.schedule.setSiteCalendar(user, id, body);
  }

  @RequiresPermission('schedule.manage')
  @Delete('projects/:id/schedule/calendar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Go back to the company calendar' })
  async clearSiteCalendar(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.schedule.clearSiteCalendar(user, id);
  }

  @RequiresPermission('schedule.view')
  @Get('schedule/calendar')
  @ApiOperation({ summary: 'The company’s working calendar' })
  companyCalendar(@CurrentUser() user: RequestUser) {
    return this.schedule.companyCalendar(user);
  }

  /** The company calendar is a company setting, so it is `tenant.manage`, like the rest of them. */
  @RequiresPermission('tenant.manage')
  @Put('schedule/calendar')
  @ApiOperation({ summary: 'Set the company’s working week and holidays' })
  setCompanyCalendar(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(scheduleCalendarSchema)) body: ScheduleCalendarInput,
  ) {
    return this.schedule.setCompanyCalendar(user, body);
  }

  // --- baselines ---------------------------------------------------------------------------------

  @RequiresPermission('schedule.view')
  @Get('projects/:id/schedule/baselines')
  @ApiOperation({ summary: 'Saved baselines' })
  listBaselines(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.baselines.list(user, id);
  }

  @RequiresPermission('schedule.manage')
  @Post('projects/:id/schedule/baselines')
  @ApiOperation({ summary: 'Save the current dates as a baseline' })
  createBaseline(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createScheduleBaselineSchema)) body: CreateScheduleBaselineInput,
  ) {
    return this.baselines.create(user, id, body);
  }

  @RequiresPermission('schedule.view')
  @Get('projects/:id/schedule/baselines/:baselineId')
  @ApiOperation({ summary: 'Every task against a baseline, and what has slipped' })
  variance(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('baselineId', ParseUUIDPipe) baselineId: string,
  ) {
    return this.baselines.variance(user, id, baselineId);
  }

  @RequiresPermission('schedule.manage')
  @Delete('projects/:id/schedule/baselines/:baselineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a baseline' })
  async deleteBaseline(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('baselineId', ParseUUIDPipe) baselineId: string,
  ): Promise<void> {
    await this.baselines.remove(user, id, baselineId);
  }

  // --- import and export -------------------------------------------------------------------------

  @RequiresPermission('schedule.manage')
  @Post('projects/:id/schedule/import/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a Microsoft Project or Primavera P6 XML file without importing it' })
  previewImport(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(scheduleImportPreviewSchema)) body: ScheduleImportPreviewInput,
  ) {
    return this.imports.preview(user, id, body);
  }

  @RequiresPermission('schedule.manage')
  @Post('projects/:id/schedule/import')
  @ApiOperation({ summary: 'Import a Microsoft Project or Primavera P6 XML file' })
  importXml(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(scheduleImportSchema)) body: ScheduleImportInput,
  ) {
    return this.imports.import(user, id, body);
  }

  @RequiresPermission('schedule.view')
  @Get('projects/:id/schedule/export')
  @ApiOperation({ summary: 'The schedule as Microsoft Project XML' })
  async exportXml(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, xml } = await this.imports.export(user, id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Cache-Control', 'no-store');
    return xml;
  }

  // --- look-ahead --------------------------------------------------------------------------------

  @RequiresPermission('schedule.view')
  @Get('schedule/look-ahead')
  @ApiOperation({ summary: 'What starts or finishes in the next two weeks, on one site or all of them' })
  async lookAhead(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(scheduleLookAheadQuerySchema)) query: ScheduleLookAheadQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (query.format !== 'csv') return this.baselines.lookAhead(user, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="look-ahead.csv"');
    res.setHeader('Cache-Control', 'no-store');
    return this.baselines.lookAheadCsv(user, query);
  }
}
