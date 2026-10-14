import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  m365CallbackSchema,
  m365ConnectSchema,
  m365SendEmailSchema,
  m365SettingsSchema,
  type M365CallbackInput,
  type M365ConnectInput,
  type M365SendEmailInput,
  type M365SettingsInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ChangeOrdersService } from '../change-orders/change-orders.service';
import { RfisService } from '../rfis/rfis.service';
import { SubmittalsService } from '../rfis/submittals.service';
import { M365CalendarSyncService } from './m365-calendar-sync.service';
import { M365ConnectionService } from './m365-connection.service';
import { M365MailService } from './m365-mail.service';
import { M365SendService } from './m365-send.service';

/**
 * Settings → Integrations → Microsoft 365. `integrations.manage` (an owner's, by default) for
 * everything but the status line every feature screen reads to decide whether to offer email.
 */
@ApiTags('integrations')
@Controller('integrations/m365')
export class M365SettingsController {
  constructor(
    private readonly connection: M365ConnectionService,
    private readonly calendar: M365CalendarSyncService,
    private readonly tenantDb: TenantDb,
  ) {}

  /** Any member: whether "Send by email" can be offered, and from which address. */
  @Get('status')
  @ApiOperation({ summary: 'Is a Microsoft 365 mailbox connected?' })
  status(@CurrentUser() user: RequestUser) {
    return this.connection.status(user.tenantId);
  }

  @RequiresPermission('integrations.manage')
  @Get()
  @ApiOperation({ summary: 'The Microsoft 365 connection, the deployment’s set-up, and recent emails' })
  overview(@CurrentUser() user: RequestUser) {
    return this.connection.overview(user);
  }

  @RequiresPermission('integrations.manage')
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Begin connecting a mailbox: returns Microsoft’s sign-in URL' })
  connect(@CurrentUser() user: RequestUser, @Body(zodBody(m365ConnectSchema)) body: M365ConnectInput) {
    return this.connection.start(user, body);
  }

  /** Posted by the web page Microsoft redirects to, with the session of whoever started. */
  @RequiresPermission('integrations.manage')
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish connecting: redeem the code Microsoft returned' })
  callback(@CurrentUser() user: RequestUser, @Body(zodBody(m365CallbackSchema)) body: M365CallbackInput) {
    return this.connection.callback(user, body);
  }

  @RequiresPermission('integrations.manage')
  @Delete()
  @ApiOperation({ summary: 'Disconnect: forget the tokens and take synced events out of the calendar' })
  disconnect(@CurrentUser() user: RequestUser) {
    return this.connection.disconnect(user, (session) => this.calendar.removeAll(user.tenantId, session).then(() => undefined));
  }

  @RequiresPermission('integrations.manage')
  @Put('settings')
  @ApiOperation({ summary: 'Switch the calendar sync on or off' })
  async settings(@CurrentUser() user: RequestUser, @Body(zodBody(m365SettingsSchema)) body: M365SettingsInput) {
    await this.connection.session(user.tenantId);
    await this.tenantDb.transaction(user.tenantId, (tx) =>
      tx.integrationM365Connection.updateMany({ data: { calendarSync: body.calendar_sync } }),
    );
    const sync = body.calendar_sync ? await this.calendar.syncTenant(user.tenantId) : null;
    if (!body.calendar_sync) await this.calendar.removeAll(user.tenantId);
    return { ...(await this.connection.overview(user)), sync };
  }

  @RequiresPermission('integrations.manage')
  @Post('calendar/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bring the synced calendar up to date now' })
  async syncNow(@CurrentUser() user: RequestUser) {
    await this.connection.session(user.tenantId);
    return { sync: await this.calendar.syncTenant(user.tenantId) };
  }
}

/**
 * "Send by email" beside WhatsApp and copy-link, on the records that already send a link. Each
 * route carries the feature's own permission, and the service goes through the feature's own
 * service for the record, so nothing here widens who may send what.
 */
@ApiTags('integrations')
@RequiresModule('projects')
@Controller()
export class M365SendController {
  constructor(
    private readonly send: M365SendService,
    private readonly mail: M365MailService,
    private readonly rfis: RfisService,
    private readonly submittals: SubmittalsService,
    private readonly changeOrders: ChangeOrdersService,
  ) {}

  @RequiresPermission('rfis.manage')
  @Post('rfis/:id/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email the designer the RFI and its answer link from the connected mailbox' })
  rfi(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(m365SendEmailSchema)) body: M365SendEmailInput,
  ) {
    return this.send.rfi(user, id, body);
  }

  @RequiresPermission('rfis.view')
  @Get('rfis/:id/emails')
  @ApiOperation({ summary: 'Emails sent about this RFI' })
  async rfiEmails(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.rfis.get(user, id);
    return this.mail.deliveriesFor(user.tenantId, 'rfi', id);
  }

  @RequiresPermission('submittals.manage')
  @Post('submittals/:id/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email the reviewer the submittal and its review link from the connected mailbox' })
  submittal(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(m365SendEmailSchema)) body: M365SendEmailInput,
  ) {
    return this.send.submittal(user, id, body);
  }

  @RequiresPermission('submittals.view')
  @Get('submittals/:id/emails')
  @ApiOperation({ summary: 'Emails sent about this submittal' })
  async submittalEmails(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.submittals.get(user, id);
    return this.mail.deliveriesFor(user.tenantId, 'submittal', id);
  }

  @RequiresPermission('change_orders.approve', 'change_orders.manage')
  @Post('change-orders/:id/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email the client that a change order is waiting on their decision' })
  changeOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(m365SendEmailSchema)) body: M365SendEmailInput,
  ) {
    return this.send.changeOrder(user, id, body);
  }

  @RequiresPermission('change_orders.view')
  @Get('change-orders/:id/emails')
  @ApiOperation({ summary: 'Emails sent about this change order' })
  async changeOrderEmails(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.changeOrders.get(user, id);
    return this.mail.deliveriesFor(user.tenantId, 'change_order', id);
  }
}
