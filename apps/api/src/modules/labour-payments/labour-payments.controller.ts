import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createLabourPaymentSchema,
  listLabourPaymentsQuerySchema,
  type CreateLabourPaymentInput,
  type ListLabourPaymentsQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { LabourPaymentsService } from './labour-payments.service';

@ApiTags('labour-payments')
@RequiresModule('labour')
@Controller('labour-payments')
export class LabourPaymentsController {
  constructor(private readonly payments: LabourPaymentsService) {}

  @RequiresPermission('payments.view')
  @Get()
  @ApiOperation({ summary: 'List advances and payments' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listLabourPaymentsQuerySchema)) query: ListLabourPaymentsQuery,
  ) {
    return this.payments.list(user, query);
  }

  /**
   * Supervisors record advances on site, so this is not restricted to accounts
   * (spec §8A: "Supervisor or accounts records an advance against a worker").
   */
  @RequiresPermission('payments.record')
  @Post()
  @ApiOperation({ summary: 'Record an advance, bonus or deduction' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createLabourPaymentSchema)) body: CreateLabourPaymentInput,
  ) {
    return this.payments.create(user, body);
  }

  @RequiresPermission('payments.reconcile')
  @Get('contractor/:id/balance')
  @ApiOperation({ summary: 'What is outstanding to one contractor' })
  balance(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.contractorBalance(user, id);
  }

  @RequiresPermission('payments.reconcile')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a cash entry not yet on a wage sheet' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.payments.archive(user, id);
  }

}
