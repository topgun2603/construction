import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  planBankTransferListQuerySchema,
  planBankTransferSettleSchema,
  type PlanBankTransferListQuery,
  type PlanBankTransferSettleInput,
} from '@sitebook/shared';
import { Public } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { PlatformBankTransfers } from './platform-bank-transfers.service';
import { PlatformGuard, type PlatformRequest } from './platform.guard';
import { PlatformOperators } from './platform-operators.service';

/**
 * Bank-transfer invoices in the platform console. `@Public()` only skips the tenant guard, as on
 * the main console controller; `PlatformGuard` authenticates every route.
 */
@ApiTags('platform')
@Public()
@UseGuards(PlatformGuard)
@Controller('admin/bank-transfers')
export class PlatformBankTransfersController {
  constructor(
    private readonly transfers: PlatformBankTransfers,
    private readonly operators: PlatformOperators,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Bank-transfer invoice requests across every company' })
  list(@Query(zodBody(planBankTransferListQuerySchema)) query: PlanBankTransferListQuery) {
    return this.transfers.list(query);
  }

  /**
   * Root operators only, like pricing a plan: marking an invoice paid hands out a term, and that
   * is a commercial act rather than support work.
   */
  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a bank-transfer invoice paid (applies the plan) or cancelled' })
  settle(
    @Req() request: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(planBankTransferSettleSchema)) body: PlanBankTransferSettleInput,
  ) {
    const phone = request.platformAdmin?.phone;
    if (!phone) throw ApiError.unauthenticated();
    if (!this.operators.isRoot(phone)) {
      throw ApiError.forbidden('Only an operator named in the deployment config can do that');
    }
    return this.transfers.settle(phone, id, body);
  }
}
