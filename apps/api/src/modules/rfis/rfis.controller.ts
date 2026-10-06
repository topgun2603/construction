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
  createRfiSchema,
  listRfisQuerySchema,
  rfiAttachmentsSchema,
  rfiDraftAiSchema,
  rfiNoteSchema,
  rfiResponseSchema,
  rfiSettingsSchema,
  rfiVoidSchema,
  updateRfiSchema,
  type CreateRfiParsed,
  type ListRfisQuery,
  type RfiAttachmentsInput,
  type RfiDraftAiInput,
  type RfiNoteInput,
  type RfiResponseInput,
  type RfiSettingsInput,
  type RfiVoidInput,
  type UpdateRfiInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { RfisService } from './rfis.service';

/**
 * RFIs, roadmap Phase 2, module 9.
 *
 * Behind `projects`, like safety and change orders: every RFI belongs to a site, and a new module
 * name would be missing from every account whose module list was stored before it existed.
 */
@ApiTags('rfis')
@RequiresModule('projects')
@Controller('rfis')
export class RfisController {
  constructor(private readonly rfis: RfisService) {}

  @RequiresPermission('rfis.view', 'submittals.view')
  @Get('settings')
  @ApiOperation({ summary: 'Company defaults: days to answer an RFI and review a submittal, reminders; AI on/off' })
  settings(@CurrentUser() user: RequestUser) {
    return this.rfis.settings(user);
  }

  /** A company-wide rule, so the account's administrators set it, not whoever raises RFIs. */
  @RequiresPermission('tenant.manage')
  @Put('settings')
  @ApiOperation({ summary: 'Change the company defaults' })
  updateSettings(@CurrentUser() user: RequestUser, @Body(zodBody(rfiSettingsSchema)) body: RfiSettingsInput) {
    return this.rfis.updateSettings(user, body);
  }

  @RequiresPermission('rfis.view')
  @Get()
  @ApiOperation({ summary: 'The RFI log, newest first, with its figures (open, overdue, average days to answer)' })
  list(@CurrentUser() user: RequestUser, @Query(zodBody(listRfisQuerySchema)) query: ListRfisQuery) {
    return this.rfis.list(user, query);
  }

  @RequiresPermission('rfis.view')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="rfis.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The RFI log as CSV, with the same filters' })
  exportCsv(@CurrentUser() user: RequestUser, @Query(zodBody(listRfisQuerySchema)) query: ListRfisQuery) {
    return this.rfis.exportCsv(user, query);
  }

  @RequiresPermission('rfis.manage')
  @Post('draft-ai')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check the site documents for an answer, then tidy the question into an RFI' })
  draftWithAi(@CurrentUser() user: RequestUser, @Body(zodBody(rfiDraftAiSchema)) body: RfiDraftAiInput) {
    return this.rfis.draftWithAi(user, body);
  }

  @RequiresPermission('rfis.view')
  @Get(':id')
  @ApiOperation({ summary: 'One RFI: the question, drawings, files and the thread of answers' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfis.get(user, id);
  }

  @RequiresPermission('rfis.manage')
  @Post()
  @ApiOperation({ summary: 'Raise an RFI, as a draft or opened straight away' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(createRfiSchema)) body: CreateRfiParsed) {
    return this.rfis.create(user, body);
  }

  @RequiresPermission('rfis.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Edit an RFI that is not closed or void' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateRfiSchema)) body: UpdateRfiInput,
  ) {
    return this.rfis.update(user, id, body);
  }

  @RequiresPermission('rfis.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft that was never sent' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfis.remove(user, id);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/attachments')
  @ApiOperation({ summary: 'Attach photos or files' })
  addAttachments(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(rfiAttachmentsSchema)) body: RfiAttachmentsInput,
  ) {
    return this.rfis.addAttachments(user, id, body);
  }

  @RequiresPermission('rfis.manage')
  @Delete(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Remove a file from the question (files on answers stay)' })
  removeAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.rfis.removeAttachment(user, id, attachmentId);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/open')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a draft: it is now waiting on the designer, due from today' })
  open(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfis.open(user, id);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A link the designer answers through without an account, and a message to send it with' })
  sendLink(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfis.sendLink(user, id);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/link/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw every link sent for this RFI' })
  revokeLinks(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfis.revokeLinks(user, id);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/responses')
  @ApiOperation({ summary: 'Reply in the thread, or record an answer that came by email or phone' })
  respond(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(rfiResponseSchema)) body: RfiResponseInput,
  ) {
    return this.rfis.respond(user, id, body);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/responses/:responseId/official')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a response as the official answer' })
  markOfficial(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('responseId', ParseUUIDPipe) responseId: string,
  ) {
    return this.rfis.markOfficial(user, id, responseId);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The answer was not one: back to waiting on the designer' })
  reopen(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(rfiNoteSchema)) body: RfiNoteInput,
  ) {
    return this.rfis.reopen(user, id, body);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close an answered RFI on its official answer' })
  close(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(rfiNoteSchema)) body: RfiNoteInput,
  ) {
    return this.rfis.close(user, id, body);
  }

  @RequiresPermission('rfis.manage')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void an RFI that is no longer needed; it stays on the log' })
  void(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(rfiVoidSchema)) body: RfiVoidInput,
  ) {
    return this.rfis.void(user, id, body);
  }

  /** Needs `change_orders.manage` as well; the service checks it, since this route admits RFI managers. */
  @RequiresPermission('rfis.manage')
  @Post(':id/change-order')
  @ApiOperation({ summary: 'Raise a draft change order from this RFI' })
  raiseChangeOrder(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfis.raiseChangeOrder(user, id);
  }
}
