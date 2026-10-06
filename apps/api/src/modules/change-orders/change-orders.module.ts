import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ChangeOrderApprovalsService } from './change-order-approvals.service';
import { ChangeOrdersController } from './change-orders.controller';
import { ChangeOrdersService } from './change-orders.service';
import { ScopeCreepService } from './scope-creep.service';

/**
 * Change orders (roadmap Phase 2, module 4).
 *
 * Exports the approval bridge, which the portal calls when a client decides, and the scope-creep
 * catcher, which daily reports and site messages call as they arrive. Neither of those modules is
 * imported back, so the dependency runs one way.
 */
@Module({
  imports: [AiModule, NotificationsModule, UploadsModule],
  controllers: [ChangeOrdersController],
  providers: [ChangeOrdersService, ChangeOrderApprovalsService, ScopeCreepService],
  // ChangeOrdersService for Microsoft 365's "send by email", which reads the change order through it.
  exports: [ChangeOrderApprovalsService, ScopeCreepService, ChangeOrdersService],
})
export class ChangeOrdersModule {}
