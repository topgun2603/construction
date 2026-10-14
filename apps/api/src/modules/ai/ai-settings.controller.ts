import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  aiDeleteDataSchema,
  aiSettingsSchema,
  type AiDeleteDataInput,
  type AiSettingsInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AiSettingsService } from './ai-settings.service';

/**
 * Settings → Security → AI and data. `tenant.manage` at the route; the service insists on an owner
 * on top, as the sign-in security sections beside it do.
 */
@ApiTags('ai')
@RequiresPermission('tenant.manage')
@Controller('ai')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'AI switches, region, provider details and the last 30 days of usage' })
  overview(@CurrentUser() user: RequestUser) {
    return this.settings.overview(user);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Turn AI features on or off for the company, and choose the region' })
  save(@CurrentUser() user: RequestUser, @Body(zodBody(aiSettingsSchema)) body: AiSettingsInput) {
    return this.settings.save(user, body);
  }

  @Post('data/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete what AI features have stored (the document page index)' })
  deleteData(@CurrentUser() user: RequestUser, @Body(zodBody(aiDeleteDataSchema)) _body: AiDeleteDataInput) {
    return this.settings.deleteData(user);
  }

  @Post('documents/reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read every unread document again so it can be asked' })
  reindex(@CurrentUser() user: RequestUser) {
    return this.settings.reindex(user);
  }
}
