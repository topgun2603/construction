import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { QualityController } from './quality.controller';
import { QualityInspectionsService } from './quality-inspections.service';
import { QualityReportsService } from './quality-reports.service';
import { QualityTemplatesService } from './quality-templates.service';
import { QualityTestsService } from './quality-tests.service';
import { SnagsService } from './snags.service';

/**
 * QA/QC (roadmap Phase 2, module 7). `UploadsModule` signs the photos and reads a voice note's
 * bytes; `AiModule` listens to it and suggests a snag when a key is configured.
 */
@Module({
  imports: [AiModule, UploadsModule, NotificationsModule],
  controllers: [QualityController],
  providers: [
    QualityTemplatesService,
    QualityInspectionsService,
    QualityTestsService,
    SnagsService,
    QualityReportsService,
  ],
  // The morning job sends the "tests due" reminders through the same service.
  exports: [QualityTestsService],
})
export class QualityModule {}
