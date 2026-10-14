import { Global, Module } from '@nestjs/common';
import { ChangeOrdersModule } from '../change-orders/change-orders.module';
import { NOTIFICATION_EMAIL_RELAY } from '../notifications/notification-email-relay';
import { RfisModule } from '../rfis/rfis.module';
import { GraphClient } from './graph-client.service';
import { M365CalendarSyncService } from './m365-calendar-sync.service';
import { M365ConfigService } from './m365-config.service';
import { M365ConnectionService } from './m365-connection.service';
import { M365MailService } from './m365-mail.service';
import { M365NotificationRelay } from './m365-notification-relay.service';
import { M365SendService } from './m365-send.service';
import { M365SendController, M365SettingsController } from './m365.controller';

/**
 * Microsoft 365 email and calendar (roadmap Phase 3, "Calendar and email").
 *
 * Global, like the other outbound channels: meetings send through it, the notifications service
 * relays to it (through a token, so notifications do not import this), and the worker's morning
 * tick runs the calendar sync. It imports the RFI and change-order modules for their services — the
 * "send by email" routes go through them — and neither imports this back.
 */
@Global()
@Module({
  imports: [RfisModule, ChangeOrdersModule],
  controllers: [M365SettingsController, M365SendController],
  providers: [
    M365ConfigService,
    GraphClient,
    M365ConnectionService,
    M365MailService,
    M365SendService,
    M365CalendarSyncService,
    M365NotificationRelay,
    { provide: NOTIFICATION_EMAIL_RELAY, useExisting: M365NotificationRelay },
  ],
  exports: [
    M365ConfigService,
    GraphClient,
    M365ConnectionService,
    M365MailService,
    M365CalendarSyncService,
    NOTIFICATION_EMAIL_RELAY,
  ],
})
export class M365Module {}
