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
  createExpenseSchema,
  decideExpenseSchema,
  expenseSummaryQuerySchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
  type CreateExpenseInput,
  type DecideExpenseInput,
  type ExpenseSummaryQuery,
  type ListExpensesQuery,
  type UpdateExpenseInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ExpensesService } from './expenses.service';

@ApiTags('expenses')
@RequiresModule('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @RequiresPermission('expenses.view')
  @Get()
  @ApiOperation({ summary: 'List expenses, pending first' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listExpensesQuerySchema)) query: ListExpensesQuery,
  ) {
    return this.expenses.list(user, query);
  }

  @Get('summary')
  @RequiresPermission('reports.view')
  @ApiOperation({ summary: 'Spend grouped by category or site' })
  summary(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(expenseSummaryQuerySchema)) query: ExpenseSummaryQuery,
  ) {
    return this.expenses.summary(user, query);
  }

  @RequiresPermission('expenses.record')
  @Post()
  @ApiOperation({ summary: 'Record a site expense' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createExpenseSchema)) body: CreateExpenseInput,
  ) {
    return this.expenses.create(user, body);
  }

  @RequiresPermission('expenses.view')
  @Get(':id')
  @ApiOperation({ summary: 'Read one expense' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.get(user, id);
  }

  @RequiresPermission('expenses.record')
  @Patch(':id')
  @ApiOperation({ summary: 'Correct a pending expense' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateExpenseSchema)) body: UpdateExpenseInput,
  ) {
    return this.expenses.update(user, id, body);
  }

  /** Approver-only, and never your own — enforced in the service. */
  @RequiresPermission('expenses.approve')
  @Patch(':id/decision')
  @ApiOperation({ summary: 'Approve or reject an expense' })
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(decideExpenseSchema)) body: DecideExpenseInput,
  ) {
    return this.expenses.decide(user, id, body);
  }

  @RequiresPermission('expenses.record')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard a pending or rejected expense' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.expenses.archive(user, id);
  }
}
