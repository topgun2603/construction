import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../../common/decorators';
import { AutomationService } from './automation.service';

/**
 * What runs on its own.
 *
 * Readable by anyone who manages the account or the wage sheets: the drafting job creates work
 * for accounts, so they are the people most likely to wonder where a sheet came from.
 */
@ApiTags('automation')
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @RequiresPermission('tenant.manage', 'wages.view')
  @Get()
  @ApiOperation({ summary: 'Scheduled jobs, when they run and what they touch' })
  list() {
    return this.automation.list();
  }
}
