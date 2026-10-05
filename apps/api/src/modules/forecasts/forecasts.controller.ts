import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { ForecastsService } from './forecasts.service';

/**
 * Overrun early warning.
 *
 * Gated exactly like the overview, because it is the same kind of number: what a site costs the
 * builder. A client is on the site the forecast is about and must still never see it.
 */
@ApiTags('forecasts')
@RequiresModule('dashboard')
@RequiresPermission('expenses.view')
@Controller()
export class ForecastsController {
  constructor(private readonly forecasts: ForecastsService) {}

  @Get('forecasts')
  @ApiOperation({ summary: 'Latest cost forecast for every active site the caller can see' })
  latest(@CurrentUser() user: RequestUser) {
    return this.forecasts.latest(user);
  }

  @Get('projects/:id/forecast')
  @ApiOperation({ summary: 'Latest cost forecast for one site' })
  forProject(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.forecasts.forProject(user, id);
  }

  @Post('projects/:id/forecast/refresh')
  @ApiOperation({ summary: 'Work the site’s forecast out again now' })
  refresh(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.forecasts.refreshProject(user, id);
  }
}
