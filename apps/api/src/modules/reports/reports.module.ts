import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { TaxReportService } from './tax-report.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, TaxReportService],
  exports: [ReportsService],
})
export class ReportsModule {}
