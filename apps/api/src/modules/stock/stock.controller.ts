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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listStockMovementsQuerySchema,
  materialOverrunQuerySchema,
  recordStockMovementSchema,
  setMaterialEstimatesSchema,
  stockOnHandQuerySchema,
  type ListStockMovementsQuery,
  type MaterialOverrunQuery,
  type RecordStockMovementInput,
  type SetMaterialEstimatesInput,
  type StockOnHandQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { StockService } from './stock.service';

/**
 * Materials stock (spec §3 item 10).
 *
 * Gated on the `stock` module, which is Pro. A Starter tenant still raises indents and tracks
 * spend; what they do not get is the ledger behind them.
 */
@ApiTags('stock')
@RequiresModule('stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @RequiresPermission('stock.view')
  @Get()
  @ApiOperation({ summary: 'What is on site now, per material' })
  onHand(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(stockOnHandQuerySchema)) query: StockOnHandQuery,
  ) {
    return this.stock.onHand(user, query);
  }

  @RequiresPermission('stock.view')
  @Get('movements')
  @ApiOperation({ summary: 'The stock ledger' })
  movements(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listStockMovementsQuerySchema)) query: ListStockMovementsQuery,
  ) {
    return this.stock.list(user, query);
  }

  @RequiresPermission('stock.record')
  @Post('movements')
  @ApiOperation({ summary: 'Record material received or used' })
  record(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(recordStockMovementSchema)) body: RecordStockMovementInput,
  ) {
    return this.stock.record(user, body);
  }

  /**
   * Gated on `stock.view` rather than `reports.view`: this is the stock ledger asked a question,
   * and anyone trusted with the store should be able to see whether they are over.
   */
  @RequiresPermission('stock.view')
  @Get('overrun')
  @ApiOperation({ summary: 'Consumption against estimate' })
  overrun(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(materialOverrunQuerySchema)) query: MaterialOverrunQuery,
  ) {
    return this.stock.overrun(user, query);
  }

  @RequiresPermission('stock.view')
  @Get('estimates/:projectId')
  @ApiOperation({ summary: 'What a site is expected to consume' })
  estimates(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.stock.listEstimates(user, projectId);
  }

  /**
   * PUT because it is idempotent per material: sending the same estimate twice leaves one row,
   * which is what a revised bill of quantities needs.
   */
  @RequiresPermission('estimates.manage')
  @Put('estimates/:projectId')
  @ApiOperation({ summary: 'Set or revise estimates for a site' })
  setEstimates(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(setMaterialEstimatesSchema)) body: SetMaterialEstimatesInput,
  ) {
    return this.stock.setEstimates(user, projectId, body);
  }

  @RequiresPermission('estimates.manage')
  @Delete('estimates/:projectId/:materialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Drop an estimate' })
  async removeEstimate(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('materialId', ParseUUIDPipe) materialId: string,
  ): Promise<void> {
    await this.stock.removeEstimate(user, projectId, materialId);
  }
}
