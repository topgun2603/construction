import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ChecksService } from './checks.service';

const decideSchema = z.object({
  decision: z.enum(['confirmed', 'dismissed']),
  note: z.string().trim().max(500).optional(),
});

/**
 * Leakage and fraud checks.
 *
 * Read with `expenses.view` — the same people who see what sites cost. Deciding needs
 * `expenses.approve`: confirming that a supervisor double-booked a worker is a call about money,
 * made by whoever already signs off on spend.
 */
@ApiTags('checks')
@RequiresModule('dashboard')
@Controller('checks')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @RequiresPermission('expenses.view')
  @Get()
  @ApiOperation({ summary: 'Leak and fraud findings, open or already decided' })
  list(@CurrentUser() user: RequestUser, @Query('status') status?: string) {
    return this.checks.list(user, status === 'decided' ? 'decided' : 'open');
  }

  @RequiresPermission('expenses.approve')
  @Patch(':id')
  @ApiOperation({ summary: 'Confirm or dismiss a finding' })
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(decideSchema)) body: z.infer<typeof decideSchema>,
  ) {
    return this.checks.decide(user, id, body);
  }

  @RequiresPermission('expenses.approve')
  @Post('run')
  @ApiOperation({ summary: 'Run the checks now rather than waiting for the night' })
  run(@CurrentUser() user: RequestUser) {
    return this.checks.runTenant(user.tenantId);
  }
}
