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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  amendReceiptSchema,
  createIndentSchema,
  listIndentsQuerySchema,
  updateIndentStatusSchema,
  type AmendReceiptInput,
  type CreateIndentInput,
  type ListIndentsQuery,
  type UpdateIndentStatusInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { IndentsService } from './indents.service';

@ApiTags('indents')
@RequiresModule('indents')
@Controller('indents')
export class IndentsController {
  constructor(private readonly indents: IndentsService) {}

  @RequiresPermission('indents.raise', 'indents.approve')
  @Get()
  @ApiOperation({ summary: 'List material indents, urgent first' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listIndentsQuerySchema)) query: ListIndentsQuery,
  ) {
    return this.indents.list(user, query);
  }

  @RequiresPermission('indents.raise')
  @Post()
  @ApiOperation({ summary: 'Raise a material indent' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createIndentSchema)) body: CreateIndentInput,
  ) {
    return this.indents.create(user, body);
  }

  @RequiresPermission('indents.raise', 'indents.approve')
  @Get(':id')
  @ApiOperation({ summary: 'Read one indent' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.indents.get(user, id);
  }

  /** Role is checked inside: approving and rejecting are approver-only. */
  @RequiresPermission('indents.raise', 'indents.approve')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Approve, reject, order or receive an indent' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateIndentStatusSchema)) body: UpdateIndentStatusInput,
  ) {
    return this.indents.updateStatus(user, id, body);
  }

  @RequiresPermission('indents.raise')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw an unanswered indent' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.indents.archive(user, id);
  }


  /**
   * Correcting the counts on a delivery, which is not a status change — the indent is already
   * received. Needs `stock.record` rather than an indent permission: the person who recounts what
   * is in the store is the person who looks after it.
   */
  @RequiresPermission('stock.record')
  @Patch(':id/receipt')
  @ApiOperation({ summary: 'Correct what a delivery actually contained' })
  amendReceipt(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(amendReceiptSchema)) body: AmendReceiptInput,
  ) {
    return this.indents.amendReceipt(user, id, body);
  }

}
