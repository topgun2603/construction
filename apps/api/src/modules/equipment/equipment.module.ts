import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CostCodesModule } from '../cost-codes/cost-codes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { EquipmentController } from './equipment.controller';
import { EquipmentCostsService } from './equipment-costs.service';
import { EquipmentLogsService } from './equipment-logs.service';
import { EquipmentMaintenanceService } from './equipment-maintenance.service';
import { EquipmentService } from './equipment.service';

/**
 * Equipment and plant (roadmap Phase 2, module 10): the register, allocations to sites, daily logs
 * and fuel, servicing, documents, and cost per site. Builds on sites, vendors, expenses and stock,
 * and registers itself with cost codes as a source of actual cost; cost codes never imports this
 * module back. The worker imports it for the morning service and document reminders, and the
 * checks module for the fuel leakage check.
 */
@Module({
  imports: [AiModule, CostCodesModule, NotificationsModule, UploadsModule],
  controllers: [EquipmentController],
  providers: [EquipmentService, EquipmentLogsService, EquipmentMaintenanceService, EquipmentCostsService],
  exports: [EquipmentMaintenanceService, EquipmentCostsService],
})
export class EquipmentModule {}
