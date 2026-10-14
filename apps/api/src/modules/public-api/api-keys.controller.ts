import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { publicApiKeyCreateSchema, type PublicApiKeyCreateInput } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ApiKeysService } from './api-keys.service';

/**
 * Settings → Developers → API keys, on the internal API with a session — never with a key: a key
 * cannot make or see keys. `tenant.manage` at the route; the service insists on an owner on top.
 */
@ApiTags('developers')
@RequiresPermission('tenant.manage')
@Controller('developers/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'The company’s API keys, live and revoked' })
  list(@CurrentUser() user: RequestUser) {
    return this.keys.list(user);
  }

  @Post()
  @ApiOperation({ summary: 'Make a key; the key itself is in this answer only' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(publicApiKeyCreateSchema)) body: PublicApiKeyCreateInput) {
    return this.keys.create(user, body);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a key working, from the next request' })
  revoke(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(user, id);
  }
}
