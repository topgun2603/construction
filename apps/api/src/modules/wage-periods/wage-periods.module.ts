import { Module } from '@nestjs/common';
import { WorkerDocumentsModule } from '../worker-documents/worker-documents.module';
import { WagePeriodsController } from './wage-periods.controller';
import { WagePeriodsService } from './wage-periods.service';

@Module({
  // The Saudi payroll file reads each worker's Iqama or national ID from their papers.
  imports: [WorkerDocumentsModule],
  controllers: [WagePeriodsController],
  providers: [WagePeriodsService],
  exports: [WagePeriodsService],
})
export class WagePeriodsModule {}
