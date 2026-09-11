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
import { z } from 'zod';
import {
  assignWorkerSchema,
  createWorkerSchema,
  isoDateSchema,
  listWorkersQuerySchema,
  updateWorkerSchema,
  type AssignWorkerInput,
  type CreateWorkerInput,
  type ListWorkersQuery,
  type UpdateWorkerInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { WorkersService } from './workers.service';

const ledgerQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

@ApiTags('workers')
@RequiresModule('labour')
@Controller('workers')
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @RequiresPermission('workers.view')
  @Get()
  @ApiOperation({ summary: 'List workers, optionally the roll call for one site and date' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listWorkersQuerySchema)) query: ListWorkersQuery,
  ) {
    return this.workers.list(user, query);
  }

  /** Supervisors add workers on site, so this is deliberately not owner-only. */
  @RequiresPermission('workers.manage')
  @Post()
  @ApiOperation({ summary: 'Add a worker' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createWorkerSchema)) body: CreateWorkerInput,
  ) {
    return this.workers.create(user, body);
  }

  @RequiresPermission('workers.view')
  @Get(':id')
  @ApiOperation({ summary: 'Read one worker' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workers.get(user, id);
  }

  @RequiresPermission('workers.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a worker (wage changes apply going forward)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateWorkerSchema)) body: UpdateWorkerInput,
  ) {
    return this.workers.update(user, id, body);
  }

  @RequiresPermission('workers.delete')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a worker added by mistake' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.workers.archive(user, id);
  }

  @RequiresPermission('workers.manage')
  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign a worker to a site' })
  assign(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(assignWorkerSchema)) body: AssignWorkerInput,
  ) {
    return this.workers.assign(user, id, body);
  }

  @RequiresPermission('wages.view', 'payments.view')
  @Get(':id/ledger')
  @ApiOperation({ summary: 'Attendance and payments with a running balance' })
  ledger(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodBody(ledgerQuerySchema)) query: z.infer<typeof ledgerQuerySchema>,
  ) {
    return this.workers.ledger(user, id, query);
  }
}
