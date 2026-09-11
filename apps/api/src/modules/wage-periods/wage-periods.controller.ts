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
  generateWagePeriodSchema,
  listWagePeriodsQuerySchema,
  payWagePeriodSchema,
  type GenerateWagePeriodInput,
  type ListWagePeriodsQuery,
  type PayWagePeriodInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { WagePeriodsService } from './wage-periods.service';

/** The wage ledger belongs to accounts and the owner (spec §2). */
@ApiTags('wage-periods')
@RequiresModule('labour')
@RequiresPermission('wages.view')
@Controller('wage-periods')
export class WagePeriodsController {
  constructor(private readonly periods: WagePeriodsService) {}

  @Get()
  @ApiOperation({ summary: 'List wage periods' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listWagePeriodsQuerySchema)) query: ListWagePeriodsQuery,
  ) {
    return this.periods.list(user, query);
  }

  @RequiresPermission('wages.generate')
  @Post('generate')
  @ApiOperation({ summary: 'Build wage lines from attendance for a date range' })
  generate(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(generateWagePeriodSchema)) body: GenerateWagePeriodInput,
  ) {
    return this.periods.generate(user, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One wage period with its lines' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.periods.get(user, id);
  }

  @RequiresPermission('wages.finalise')
  @Post(':id/finalise')
  @ApiOperation({ summary: 'Freeze the lines and lock attendance for the range' })
  finalise(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.periods.finalise(user, id);
  }

  @RequiresPermission('wages.pay')
  @Post(':id/pay')
  @ApiOperation({ summary: 'Record payment against the period' })
  pay(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(payWagePeriodSchema)) body: PayWagePeriodInput,
  ) {
    return this.periods.pay(user, id, body);
  }

  /**
   * Discarding needs the same permission as creating: it is the inverse act, and anyone the
   * owner trusts to draft a period can bin a draft they did not want.
   */
  @RequiresPermission('wages.generate')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard an open period' })
  async discard(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.periods.discard(user, id);
  }

  /** Reopening is the inverse of finalising, so it takes the same permission. */
  @RequiresPermission('wages.finalise')
  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a finalised period that has not been paid' })
  reopen(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.periods.reopen(user, id);
  }

}
