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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createApprovalSchema,
  createPaymentStageSchema,
  decideApprovalSchema,
  listApprovalsQuerySchema,
  recordClientPaymentSchema,
  reorderPaymentStagesSchema,
  updatePaymentStageSchema,
  type CreateApprovalInput,
  type CreatePaymentStageInput,
  type DecideApprovalInput,
  type ListApprovalsQuery,
  type RecordClientPaymentInput,
  type ReorderPaymentStagesInput,
  type UpdatePaymentStageInput,
} from '@sitebook/shared';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { RequestUser } from '../../common/auth/request-user';
import { ApprovalsService } from './approvals.service';
import { ClientBillingService } from './client-billing.service';

/**
 * The payment schedule on one site.
 *
 * Behind `client_portal`, because this is the client's half of the job. Reading needs
 * `client_payments.view`, which the client has for their own sites and a supervisor does not have
 * at all — what the client owes is not site information.
 */
@ApiTags('client billing')
@RequiresModule('client_portal')
@Controller('projects/:id/payment-schedule')
export class PaymentScheduleController {
  constructor(private readonly billing: ClientBillingService) {}

  @RequiresPermission('client_payments.view')
  @Get()
  @ApiOperation({ summary: 'What the client owes on this site, and what has arrived' })
  schedule(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.schedule(user, id);
  }

  @RequiresPermission('client_payments.manage')
  @Post()
  @ApiOperation({ summary: 'Add an instalment' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createPaymentStageSchema)) body: CreatePaymentStageInput,
  ) {
    return this.billing.createStage(user, id, body);
  }

  @RequiresPermission('client_payments.manage')
  @Put('order')
  @ApiOperation({ summary: 'Reorder the schedule' })
  reorder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reorderPaymentStagesSchema)) body: ReorderPaymentStagesInput,
  ) {
    return this.billing.reorderStages(user, id, body);
  }

  @RequiresPermission('client_payments.view')
  @Get('receipts')
  @ApiOperation({ summary: 'Money received from the client' })
  receipts(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.receipts(user, id);
  }

  @RequiresPermission('client_payments.manage')
  @Post('receipts')
  @ApiOperation({ summary: 'Record money received' })
  record(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(recordClientPaymentSchema)) body: RecordClientPaymentInput,
  ) {
    return this.billing.recordPayment(user, id, body);
  }
}

@ApiTags('client billing')
@RequiresModule('client_portal')
@Controller('payment-stages')
export class PaymentStagesController {
  constructor(private readonly billing: ClientBillingService) {}

  @RequiresPermission('client_payments.manage')
  @Patch(':stageId')
  @ApiOperation({ summary: 'Edit an instalment, or mark it raised with the client' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body(zodBody(updatePaymentStageSchema)) body: UpdatePaymentStageInput,
  ) {
    return this.billing.updateStage(user, stageId, body);
  }

  @RequiresPermission('client_payments.manage')
  @Delete(':stageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an instalment nothing has been paid against' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('stageId', ParseUUIDPipe) stageId: string,
  ): Promise<void> {
    await this.billing.removeStage(user, stageId);
  }
}

@ApiTags('client billing')
@RequiresModule('client_portal')
@Controller('client-payments')
export class ClientPaymentsController {
  constructor(private readonly billing: ClientBillingService) {}

  @RequiresPermission('client_payments.manage')
  @Delete(':paymentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a receipt recorded by mistake' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<void> {
    await this.billing.removePayment(user, paymentId);
  }
}

/**
 * Approvals.
 *
 * Reading needs only `projects.view`: the client has to see what they are being asked, and the team
 * has to see what is still waiting. The two halves that matter are separated — `approvals.request`
 * to ask, `approvals.decide` to answer.
 */
@ApiTags('approvals')
@RequiresModule('client_portal')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @RequiresPermission('projects.view')
  @Get()
  @ApiOperation({ summary: 'Approvals, waiting ones first' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listApprovalsQuerySchema)) query: ListApprovalsQuery,
  ) {
    return this.approvals.list(user, query);
  }

  @RequiresPermission('approvals.decide')
  @Patch(':approvalId')
  @ApiOperation({ summary: 'Approve or reject, on the record' })
  decide(
    @CurrentUser() user: RequestUser,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body(zodBody(decideApprovalSchema)) body: DecideApprovalInput,
  ) {
    return this.approvals.decide(user, approvalId, body);
  }

  @RequiresPermission('approvals.request')
  @Delete(':approvalId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a request nobody has answered yet' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ): Promise<void> {
    await this.approvals.remove(user, approvalId);
  }
}

@ApiTags('approvals')
@RequiresModule('client_portal')
@Controller('projects/:id/approvals')
export class ProjectApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @RequiresPermission('approvals.request')
  @Post()
  @ApiOperation({ summary: 'Ask the client to approve something' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createApprovalSchema)) body: CreateApprovalInput,
  ) {
    return this.approvals.create(user, id, body);
  }
}
