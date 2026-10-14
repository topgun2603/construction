import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  QUALITY_EXPORT_KINDS,
  addSnagPhotosSchema,
  completeQualityInspectionSchema,
  createQualityInspectionSchema,
  createQualityTemplateSchema,
  createQualityTestSchema,
  createSnagSchema,
  fixSnagSchema,
  listQualityInspectionsQuerySchema,
  listQualityTemplatesQuerySchema,
  listQualityTestsQuerySchema,
  listSnagsQuerySchema,
  qualityReportQuerySchema,
  quickSnagSchema,
  recordQualityInspectionItemsSchema,
  recordQualityTestResultSchema,
  reopenSnagSchema,
  signQualityInspectionSchema,
  updateQualityInspectionSchema,
  updateQualityTemplateSchema,
  updateQualityTestSchema,
  updateSnagSchema,
  verifySnagSchema,
  type AddSnagPhotosInput,
  type CompleteQualityInspectionInput,
  type CreateQualityInspectionInput,
  type CreateQualityTemplateInput,
  type CreateQualityTestInput,
  type CreateSnagInput,
  type FixSnagInput,
  type ListQualityInspectionsQuery,
  type ListQualityTemplatesQuery,
  type ListQualityTestsQuery,
  type ListSnagsQuery,
  type QualityExportKind,
  type QualityReportQuery,
  type QuickSnagInput,
  type RecordQualityInspectionItemsInput,
  type RecordQualityTestResultInput,
  type ReopenSnagInput,
  type SignQualityInspectionInput,
  type UpdateQualityInspectionInput,
  type UpdateQualityTemplateInput,
  type UpdateQualityTestInput,
  type UpdateSnagInput,
  type VerifySnagInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { QualityInspectionsService } from './quality-inspections.service';
import { QualityReportsService } from './quality-reports.service';
import { QualityTemplatesService } from './quality-templates.service';
import { QualityTestsService } from './quality-tests.service';
import { SnagsService } from './snags.service';

/**
 * QA/QC (roadmap Phase 2, module 7): checklists, inspections, material tests, snags and the punch
 * list.
 *
 * Behind `projects`, like cost codes and subcontracts: quality is part of running a site, and a new
 * module name would be missing from every account whose module list was stored before it existed.
 *
 * Reading takes `view` or `inspect` — a supervisor running a pour card has to see the checklist.
 * The client reaches only the two portal routes at the bottom (and an inspection shared with them),
 * on `projects.view`, which every role that can see a site holds.
 */
@ApiTags('quality')
@RequiresModule('projects')
@Controller()
export class QualityController {
  constructor(
    private readonly templates: QualityTemplatesService,
    private readonly inspections: QualityInspectionsService,
    private readonly tests: QualityTestsService,
    private readonly snags: SnagsService,
    private readonly reports: QualityReportsService,
  ) {}

  // --- checklist library -------------------------------------------------------------------------

  @RequiresPermission('quality.view', 'quality.inspect', 'quality.manage')
  @Get('quality/templates')
  @ApiOperation({ summary: 'The company’s checklists; the standard set is copied in on first use' })
  listTemplates(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listQualityTemplatesQuerySchema)) query: ListQualityTemplatesQuery,
  ) {
    return this.templates.list(user, query);
  }

  @RequiresPermission('quality.view', 'quality.inspect', 'quality.manage')
  @Get('quality/templates/:id')
  @ApiOperation({ summary: 'One checklist and its lines' })
  getTemplate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(user, id);
  }

  @RequiresPermission('quality.manage')
  @Post('quality/templates')
  @ApiOperation({ summary: 'Write a checklist' })
  createTemplate(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createQualityTemplateSchema)) body: CreateQualityTemplateInput,
  ) {
    return this.templates.create(user, body);
  }

  @RequiresPermission('quality.manage')
  @Patch('quality/templates/:id')
  @ApiOperation({ summary: 'Edit a checklist; lines are replaced, inspections keep their copy' })
  updateTemplate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateQualityTemplateSchema)) body: UpdateQualityTemplateInput,
  ) {
    return this.templates.update(user, id, body);
  }

  @RequiresPermission('quality.manage')
  @Delete('quality/templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unused checklist, or archive a used one' })
  async removeTemplate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.templates.remove(user, id);
  }

  // --- inspections -------------------------------------------------------------------------------

  @RequiresPermission('quality.view', 'quality.inspect')
  @Get('quality/inspections')
  @ApiOperation({ summary: 'Inspections, company-wide or for one site' })
  listInspections(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listQualityInspectionsQuerySchema)) query: ListQualityInspectionsQuery,
  ) {
    return this.inspections.list(user, query);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/inspections')
  @ApiOperation({ summary: 'Start an inspection from a checklist on a site' })
  createInspection(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createQualityInspectionSchema)) body: CreateQualityInspectionInput,
  ) {
    return this.inspections.create(user, body);
  }

  /** Also the client's, for an inspection shared with them; the service enforces which. */
  @RequiresPermission('quality.view', 'quality.inspect', 'projects.view')
  @Get('quality/inspections/:id')
  @ApiOperation({ summary: 'One inspection with its lines, photos, snags and signatures' })
  getInspection(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.get(user, id);
  }

  @RequiresPermission('quality.inspect')
  @Patch('quality/inspections/:id')
  @ApiOperation({ summary: 'Edit an open inspection, or share a signed one with the client' })
  updateInspection(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateQualityInspectionSchema)) body: UpdateQualityInspectionInput,
  ) {
    return this.inspections.update(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Put('quality/inspections/:id/items')
  @ApiOperation({ summary: 'Answer lines: pass/fail/NA, readings, text, photos, comments' })
  recordItems(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(recordQualityInspectionItemsSchema)) body: RecordQualityInspectionItemsInput,
  ) {
    return this.inspections.recordItems(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/inspections/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign as inspector: fixes the result and raises snags for failed lines' })
  completeInspection(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(completeQualityInspectionSchema)) body: CompleteQualityInspectionInput,
  ) {
    return this.inspections.complete(user, id, body);
  }

  /** The client countersigns through the portal (`approvals.decide`); a consultant with `verify`. */
  @RequiresPermission('quality.verify', 'approvals.decide')
  @Post('quality/inspections/:id/sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Countersign a completed inspection as client or consultant' })
  signInspection(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(signQualityInspectionSchema)) body: SignQualityInspectionInput,
  ) {
    return this.inspections.sign(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Delete('quality/inspections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an inspection that has not been signed' })
  async removeInspection(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.inspections.remove(user, id);
  }

  // --- material tests ----------------------------------------------------------------------------

  @RequiresPermission('quality.view', 'quality.inspect')
  @Get('quality/tests')
  @ApiOperation({ summary: 'Material and lab tests, filterable by what is due or failed' })
  listTests(@CurrentUser() user: RequestUser, @Query(zodBody(listQualityTestsQuerySchema)) query: ListQualityTestsQuery) {
    return this.tests.list(user, query);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/tests')
  @ApiOperation({ summary: 'Log a sample: one test, or a cube set with one row per age' })
  createTest(@CurrentUser() user: RequestUser, @Body(zodBody(createQualityTestSchema)) body: CreateQualityTestInput) {
    return this.tests.create(user, body);
  }

  @RequiresPermission('quality.view', 'quality.inspect')
  @Get('quality/tests/:id')
  @ApiOperation({ summary: 'One test' })
  getTest(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tests.get(user, id);
  }

  @RequiresPermission('quality.inspect')
  @Patch('quality/tests/:id')
  @ApiOperation({ summary: 'Correct a test’s details or specification' })
  updateTest(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateQualityTestSchema)) body: UpdateQualityTestInput,
  ) {
    return this.tests.update(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/tests/:id/result')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the lab’s result; a failure raises a snag' })
  recordResult(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(recordQualityTestResultSchema)) body: RecordQualityTestResultInput,
  ) {
    return this.tests.recordResult(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Delete('quality/tests/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a test that has no result yet' })
  async removeTest(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tests.remove(user, id);
  }

  // --- snags -------------------------------------------------------------------------------------

  @RequiresPermission('quality.view', 'quality.inspect')
  @Get('quality/snags')
  @ApiOperation({ summary: 'Snags, company-wide or for one site' })
  listSnags(@CurrentUser() user: RequestUser, @Query(zodBody(listSnagsQuerySchema)) query: ListSnagsQuery) {
    return this.snags.list(user, query);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/snags')
  @ApiOperation({ summary: 'Raise a snag' })
  createSnag(@CurrentUser() user: RequestUser, @Body(zodBody(createSnagSchema)) body: CreateSnagInput) {
    return this.snags.create(user, body);
  }

  /** Above `:id` so "quick" is never read as an id. */
  @RequiresPermission('quality.inspect')
  @Post('quality/snags/quick')
  @ApiOperation({ summary: 'A photo and a note or voice note becomes a draft snag' })
  quickSnag(@CurrentUser() user: RequestUser, @Body(zodBody(quickSnagSchema)) body: QuickSnagInput) {
    return this.snags.quick(user, body);
  }

  @RequiresPermission('quality.view', 'quality.inspect')
  @Get('quality/snags/:id')
  @ApiOperation({ summary: 'One snag with its photos and timeline' })
  getSnag(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.snags.get(user, id);
  }

  @RequiresPermission('quality.inspect')
  @Patch('quality/snags/:id')
  @ApiOperation({ summary: 'Edit, assign or share a snag' })
  updateSnag(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSnagSchema)) body: UpdateSnagInput,
  ) {
    return this.snags.update(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/snags/:id/photos')
  @ApiOperation({ summary: 'Add before or after photos' })
  addSnagPhotos(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(addSnagPhotosSchema)) body: AddSnagPhotosInput,
  ) {
    return this.snags.addPhotos(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/snags/:id/open')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a draft snag' })
  openSnag(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.snags.open(user, id);
  }

  @RequiresPermission('quality.inspect')
  @Post('quality/snags/:id/fix')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark fixed, with the “after” photo' })
  fixSnag(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(fixSnagSchema)) body: FixSnagInput,
  ) {
    return this.snags.fix(user, id, body);
  }

  @RequiresPermission('quality.verify')
  @Post('quality/snags/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check a fix and close the snag' })
  verifySnag(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(verifySnagSchema)) body: VerifySnagInput,
  ) {
    return this.snags.verify(user, id, body);
  }

  @RequiresPermission('quality.verify')
  @Post('quality/snags/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The fix did not hold: reopen with the reason' })
  reopenSnag(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reopenSnagSchema)) body: ReopenSnagInput,
  ) {
    return this.snags.reopen(user, id, body);
  }

  @RequiresPermission('quality.inspect')
  @Delete('quality/snags/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard a draft snag' })
  async removeSnag(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.snags.remove(user, id);
  }

  // --- reports -----------------------------------------------------------------------------------

  @RequiresPermission('quality.view')
  @Get('quality/reports/summary')
  @ApiOperation({ summary: 'Open snags by site/trade/assignee/age, pass rate, test failures' })
  summary(@CurrentUser() user: RequestUser, @Query(zodBody(qualityReportQuerySchema)) query: QualityReportQuery) {
    return this.reports.summary(user, query);
  }

  @RequiresPermission('quality.view')
  @Get('quality/export/:kind')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The snag, inspection or test register as CSV' })
  export(
    @CurrentUser() user: RequestUser,
    @Param('kind') kind: string,
    @Query(zodBody(qualityReportQuerySchema)) query: QualityReportQuery,
  ) {
    if (!(QUALITY_EXPORT_KINDS as readonly string[]).includes(kind)) throw ApiError.notFound('Export');
    return this.reports.exportCsv(user, kind as QualityExportKind, query);
  }

  // --- the client's view -------------------------------------------------------------------------

  @RequiresPermission('projects.view')
  @Get('projects/:id/punch-list')
  @ApiOperation({ summary: 'The handover punch list: client-visible snags with their photos' })
  punchList(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.snags.punchList(user, id);
  }

  @RequiresPermission('projects.view')
  @Get('projects/:id/quality/shared-inspections')
  @ApiOperation({ summary: 'Completed inspections shared with the client to countersign' })
  sharedInspections(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.shared(user, id);
  }
}
