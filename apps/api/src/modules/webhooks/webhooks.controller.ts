import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  webhookEndpointCreateSchema,
  webhookEndpointUpdateSchema,
  type WebhookEndpointCreateInput,
  type WebhookEndpointUpdateInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { WebhookEndpointsService } from './webhook-endpoints.service';

/**
 * Settings → Developers → Webhooks. `tenant.manage` at the route; the service insists on an owner,
 * as the security settings do.
 */
@ApiTags('developers')
@RequiresPermission('tenant.manage')
@Controller('developers/webhooks')
export class WebhooksController {
  constructor(private readonly endpoints: WebhookEndpointsService) {}

  @Get()
  @ApiOperation({ summary: 'The company’s webhook endpoints' })
  list(@CurrentUser() user: RequestUser) {
    return this.endpoints.list(user);
  }

  @Post()
  @ApiOperation({ summary: 'Register an endpoint; the signing secret is in this answer only' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(webhookEndpointCreateSchema)) body: WebhookEndpointCreateInput) {
    return this.endpoints.create(user, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change an endpoint’s address or events, or switch it off and on' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(webhookEndpointUpdateSchema)) body: WebhookEndpointUpdateInput,
  ) {
    return this.endpoints.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an endpoint and its delivery log' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.remove(user, id);
  }

  @Post(':id/ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test event now and report what the receiver answered' })
  ping(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.ping(user, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'The endpoint’s delivery log, newest first, with every try' })
  deliveries(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.endpoints.deliveryLog(user, id, cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined);
  }

  @Post('deliveries/:deliveryId/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a delivery’s event to its endpoint again, now' })
  resend(@CurrentUser() user: RequestUser, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) {
    return this.endpoints.resend(user, deliveryId);
  }
}
