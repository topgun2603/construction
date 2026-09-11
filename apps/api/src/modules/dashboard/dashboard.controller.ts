import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { DashboardService } from './dashboard.service';

/**
 * The all-sites overview.
 *
 * Gated on `expenses.view` because of what the screen actually is: labour cost this month, spend,
 * committed budget, approvals waiting. Every staff preset holds that permission; the client preset
 * deliberately does not, and a client must never be handed the builder's cost of building their
 * house — the margin on the job is in the difference between that figure and the contract.
 *
 * Scoping alone would not have saved this. `scopeFilter` narrows the overview to the sites you are
 * on, and a client is on the site the numbers are about.
 */
@ApiTags('dashboard')
@RequiresModule('dashboard')
@RequiresPermission('expenses.view')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'All sites with today’s status, headcount and labour cost' })
  overview(@CurrentUser() user: RequestUser) {
    return this.dashboard.overview(user);
  }

  @Get('today')
  @ApiOperation({ summary: 'Today’s DPR feed and the approvals waiting on you' })
  today(@CurrentUser() user: RequestUser) {
    return this.dashboard.today(user);
  }
}
