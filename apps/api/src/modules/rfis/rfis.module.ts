import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { RfiLinksController } from './rfi-links.controller';
import { RfiLinksService } from './rfi-links.service';
import { RfiRemindersService } from './rfi-reminders.service';
import { RfisController } from './rfis.controller';
import { RfisService } from './rfis.service';
import { SubmittalApprovalsService } from './submittal-approvals.service';
import { SubmittalsController } from './submittals.controller';
import { SubmittalsService } from './submittals.service';

/**
 * RFIs and submittals (roadmap Phase 2, module 9). Builds on documents, change orders and the
 * schedule by reference only.
 *
 * Exports the approval bridge, which the portal calls when a client decides a submittal, and the
 * reminders, which the worker runs on each company's clock. Neither of those imports this module
 * back, so the dependency runs one way.
 */
@Module({
  imports: [AiModule, NotificationsModule, UploadsModule],
  controllers: [RfisController, SubmittalsController, RfiLinksController],
  providers: [RfisService, SubmittalsService, RfiLinksService, RfiRemindersService, SubmittalApprovalsService],
  exports: [SubmittalApprovalsService, RfiRemindersService],
})
export class RfisModule {}
