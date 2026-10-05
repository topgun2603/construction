import { Module } from '@nestjs/common';
import { ScheduleBaselinesService } from './schedule-baselines.service';
import { ScheduleImportService } from './schedule-import.service';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

/**
 * Scheduling (roadmap Phase 2, module 6): Gantt, links, critical path, baselines, look-ahead, and
 * Microsoft Project / Primavera P6 import. The engine itself is pure, in `@sitebook/shared`.
 */
@Module({
  controllers: [SchedulingController],
  providers: [SchedulingService, ScheduleBaselinesService, ScheduleImportService],
})
export class SchedulingModule {}
