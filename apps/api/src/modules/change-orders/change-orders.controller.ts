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
  changeOrderAttachmentSchema,
  changeOrderClientDecisionSchema,
  changeOrderContractValueSchema,
  changeOrderNoteSchema,
  createChangeOrderSchema,
  listChangeOrderSuggestionsQuerySchema,
  listChangeOrdersQuerySchema,
  updateChangeOrderSchema,
  type ChangeOrderAttachmentInput,
  type ChangeOrderClientDecisionInput,
  type ChangeOrderContractValueInput,
  type ChangeOrderNoteInput,
  type CreateChangeOrderInput,
  type ListChangeOrderSuggestionsQuery,
  type ListChangeOrdersQuery,
  type UpdateChangeOrderInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ChangeOrdersService } from './change-orders.service';
import { ScopeCreepService } from './scope-creep.service';

/**
 * Change orders (roadmap Phase 2, module 4).
 *
 * Behind `projects`, like cost codes and subcontracts: a change order is part of a site, and a new
 * module name would be missing from every account whose module list was stored before it existed.
 *
 * The client never reads these routes — they show cost and margin. The client sees a change order
 * through the portal approval it is attached to, which carries only the price and the days.
 */
@ApiTags('change-orders')
@RequiresModule('projects')
@Controller()
export class ChangeOrdersController {
  constructor(
    private readonly changeOrders: ChangeOrdersService,
    private readonly scopeCreep: ScopeCreepService,
  ) {}

  @RequiresPermission('change_orders.view')
  @Get('change-orders')
  @ApiOperation({ summary: 'The change order register, company-wide or for one site, with totals' })
  list(@CurrentUser() user: RequestUser, @Query(zodBody(listChangeOrdersQuerySchema)) query: ListChangeOrdersQuery) {
    return this.changeOrders.list(user, query);
  }

  @RequiresPermission('change_orders.view')
  @Get('change-orders/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="change-orders.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The register as CSV' })
  exportCsv(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listChangeOrdersQuerySchema)) query: ListChangeOrdersQuery,
  ) {
    return this.changeOrders.exportCsv(user, query);
  }

  // --- the scope-creep catcher's suggestions -----------------------------------------------------
  // Declared before `change-orders/:id` so the path is never read as an id.

  @RequiresPermission('change_orders.manage')
  @Get('change-order-suggestions')
  @ApiOperation({ summary: 'Extra work spotted in daily reports and messages, waiting for a decision' })
  suggestions(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listChangeOrderSuggestionsQuerySchema)) query: ListChangeOrderSuggestionsQuery,
  ) {
    return this.scopeCreep.list(user, query);
  }

  @RequiresPermission('change_orders.manage')
  @Post('change-order-suggestions/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Not extra work after all' })
  async dismiss(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.scopeCreep.dismiss(user, id);
  }

  // --- the site's contract ----------------------------------------------------------------------

  @RequiresPermission('change_orders.view')
  @Get('projects/:id/change-order-summary')
  @ApiOperation({ summary: 'Contract value and handover as signed, as revised, and the history' })
  siteSummary(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.changeOrders.siteSummary(user, id);
  }

  @RequiresPermission('change_orders.manage')
  @Put('projects/:id/contract-value')
  @ApiOperation({ summary: 'Set the contract value as signed, before any change order' })
  setContractValue(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(changeOrderContractValueSchema)) body: ChangeOrderContractValueInput,
  ) {
    return this.changeOrders.setContractValue(user, id, body);
  }

  // --- one change order --------------------------------------------------------------------------

  @RequiresPermission('change_orders.view')
  @Get('change-orders/:id')
  @ApiOperation({ summary: 'One change order: lines, figures, approvals and what it moved' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.changeOrders.get(user, id);
  }

  @RequiresPermission('change_orders.manage')
  @Post('change-orders')
  @ApiOperation({ summary: 'Raise a change order, optionally from a scope-creep suggestion' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(createChangeOrderSchema)) body: CreateChangeOrderInput) {
    return this.changeOrders.create(user, body);
  }

  @RequiresPermission('change_orders.manage')
  @Patch('change-orders/:id')
  @ApiOperation({ summary: 'Edit a draft; `lines` replaces them all' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateChangeOrderSchema)) body: UpdateChangeOrderInput,
  ) {
    return this.changeOrders.update(user, id, body);
  }

  @RequiresPermission('change_orders.manage')
  @Delete('change-orders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a first draft nobody has seen' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.changeOrders.remove(user, id);
  }

  @RequiresPermission('change_orders.manage')
  @Post('change-orders/:id/attachments')
  @ApiOperation({ summary: 'Attach a library document or an uploaded photo' })
  addAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(changeOrderAttachmentSchema)) body: ChangeOrderAttachmentInput,
  ) {
    return this.changeOrders.addAttachment(user, id, body);
  }

  @RequiresPermission('change_orders.manage')
  @Delete('change-orders/:id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Take an attachment off a draft' })
  removeAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.changeOrders.removeAttachment(user, id, attachmentId);
  }

  // --- the workflow ------------------------------------------------------------------------------

  @RequiresPermission('change_orders.manage')
  @Post('change-orders/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask for the internal approval' })
  submit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.changeOrders.submit(user, id);
  }

  @RequiresPermission('change_orders.approve')
  @Post('change-orders/:id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a submitted change order back to draft, with the reason' })
  returnToDraft(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(changeOrderNoteSchema)) body: ChangeOrderNoteInput,
  ) {
    return this.changeOrders.returnToDraft(user, id, body);
  }

  @RequiresPermission('change_orders.approve')
  @Post('change-orders/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve internally and send to the client for their decision' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(changeOrderNoteSchema)) body: ChangeOrderNoteInput,
  ) {
    return this.changeOrders.approve(user, id, body);
  }

  /**
   * The client's decision recorded from the change order — the same approval and the same rule as
   * the portal's own route. Needs `approvals.decide` *and* `change_orders.view`: whoever records it
   * here is looking at the cost side too, which a client never does.
   */
  @RequiresPermission('approvals.decide')
  @Post('change-orders/:id/client-decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the client’s approval or rejection' })
  clientDecision(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(changeOrderClientDecisionSchema)) body: ChangeOrderClientDecisionInput,
  ) {
    return this.changeOrders.clientDecision(user, id, body);
  }

  @RequiresPermission('change_orders.manage')
  @Post('change-orders/:id/revise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rework a rejected change order as its next revision' })
  revise(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.changeOrders.revise(user, id);
  }

  @RequiresPermission('change_orders.manage')
  @Post('change-orders/:id/implement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an approved change order as built' })
  implement(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.changeOrders.implement(user, id);
  }

  @RequiresPermission('change_orders.manage')
  @Post('change-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Drop a change order the client has not approved' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(changeOrderNoteSchema)) body: ChangeOrderNoteInput,
  ) {
    return this.changeOrders.cancel(user, id, body);
  }
}
