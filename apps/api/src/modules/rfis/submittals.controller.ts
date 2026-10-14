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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSubmittalSchema,
  listSubmittalsQuerySchema,
  resubmitSubmittalSchema,
  reviewSubmittalSchema,
  submitSubmittalSchema,
  submittalFilesSchema,
  updateSubmittalSchema,
  type ListSubmittalsQuery,
  type ReviewSubmittalInput,
  type SubmitSubmittalInput,
  type SubmittalFilesInput,
  type UpdateSubmittalInput,
} from '@sitebook/shared';
import type { z } from 'zod';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SubmittalsService } from './submittals.service';

/** Submittals, roadmap Phase 2, module 9. Behind `projects`, for the reason given on the RFIs. */
@ApiTags('submittals')
@RequiresModule('projects')
@Controller('submittals')
export class SubmittalsController {
  constructor(private readonly submittals: SubmittalsService) {}

  @RequiresPermission('submittals.view')
  @Get()
  @ApiOperation({ summary: 'The submittal log, newest first, with its figures' })
  list(@CurrentUser() user: RequestUser, @Query(zodBody(listSubmittalsQuerySchema)) query: ListSubmittalsQuery) {
    return this.submittals.list(user, query);
  }

  @RequiresPermission('submittals.view')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="submittals.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The submittal log as CSV, with the same filters' })
  exportCsv(@CurrentUser() user: RequestUser, @Query(zodBody(listSubmittalsQuerySchema)) query: ListSubmittalsQuery) {
    return this.submittals.exportCsv(user, query);
  }

  @RequiresPermission('submittals.view')
  @Get(':id')
  @ApiOperation({ summary: 'One submittal and every revision: files, reviews and mark-ups' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submittals.get(user, id);
  }

  @RequiresPermission('submittals.manage')
  @Post()
  @ApiOperation({ summary: 'Start a submittal: Rev 0 as a draft' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createSubmittalSchema)) body: z.output<typeof createSubmittalSchema>,
  ) {
    return this.submittals.create(user, body);
  }

  @RequiresPermission('submittals.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Edit the submittal’s details and reviewer' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSubmittalSchema)) body: UpdateSubmittalInput,
  ) {
    return this.submittals.update(user, id, body);
  }

  @RequiresPermission('submittals.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a first draft that was never submitted' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submittals.remove(user, id);
  }

  @RequiresPermission('submittals.manage')
  @Post(':id/files')
  @ApiOperation({ summary: 'Add files to the current draft revision' })
  addFiles(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(submittalFilesSchema)) body: SubmittalFilesInput,
  ) {
    return this.submittals.addFiles(user, id, body);
  }

  @RequiresPermission('submittals.manage')
  @Delete(':id/files/:fileId')
  @ApiOperation({ summary: 'Remove a file from the current draft revision' })
  removeFile(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.submittals.removeFile(user, id, fileId);
  }

  @RequiresPermission('submittals.manage')
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send the current revision for review (a client reviewer gets a portal approval)' })
  submit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(submitSubmittalSchema)) body: SubmitSubmittalInput,
  ) {
    return this.submittals.submit(user, id, body);
  }

  @RequiresPermission('submittals.manage')
  @Post(':id/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A link the consultant reviews through without an account' })
  sendLink(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submittals.sendLink(user, id);
  }

  @RequiresPermission('submittals.manage')
  @Post(':id/link/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw every link sent for the current revision' })
  revokeLinks(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submittals.revokeLinks(user, id);
  }

  @RequiresPermission('submittals.review')
  @Post(':id/start-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the current revision as under review' })
  startReview(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submittals.startReview(user, id);
  }

  @RequiresPermission('submittals.review')
  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a review outcome that came back by email or by hand' })
  review(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reviewSubmittalSchema)) body: ReviewSubmittalInput,
  ) {
    return this.submittals.review(user, id, body);
  }

  @RequiresPermission('submittals.manage')
  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start the next revision after "revise and resubmit" or a rejection' })
  resubmit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(resubmitSubmittalSchema)) body: z.output<typeof resubmitSubmittalSchema>,
  ) {
    return this.submittals.resubmit(user, id, body);
  }
}
