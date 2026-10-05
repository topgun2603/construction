import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { SafetyController } from './safety.controller';
import { SafetyIncidentsService } from './safety-incidents.service';
import { SafetyKpisService } from './safety-kpis.service';
import { SafetyObservationsService } from './safety-observations.service';
import { SafetyPermitsService } from './safety-permits.service';
import { SafetyTalksService } from './safety-talks.service';

/**
 * Safety (HSE), roadmap Phase 2, module 8: incidents, permits to work, toolbox talks, observations
 * and the safety KPIs. Builds on sites, the worker roster and the roll call; nothing imports it
 * back except the worker, which runs the expired-permit alerts.
 */
@Module({
  imports: [AiModule, NotificationsModule, UploadsModule],
  controllers: [SafetyController],
  providers: [
    SafetyIncidentsService,
    SafetyPermitsService,
    SafetyTalksService,
    SafetyObservationsService,
    SafetyKpisService,
  ],
  exports: [SafetyPermitsService],
})
export class SafetyModule {}
