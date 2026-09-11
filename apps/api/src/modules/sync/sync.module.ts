import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DprModule } from '../dpr/dpr.module';
import { IndentsModule } from '../indents/indents.module';
import { LabourPaymentsModule } from '../labour-payments/labour-payments.module';
import { WorkersModule } from '../workers/workers.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/**
 * Sync owns no rules of its own — it imports the domain modules so an offline
 * write lands through exactly the same code path as an online one.
 */
@Module({
  imports: [WorkersModule, DprModule, AttendanceModule, LabourPaymentsModule, IndentsModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
