import { Module } from '@nestjs/common';
import { CostCodesController } from './cost-codes.controller';
import { CostCodesService } from './cost-codes.service';
import { CostCommitmentsService } from './cost-commitments.service';
import { CostReportService } from './cost-report.service';

/**
 * Cost codes and budgets. Exports `CostCommitmentsService` so purchase orders and subcontracts can
 * register what they commit against a code without this module having to know their tables.
 */
@Module({
  controllers: [CostCodesController],
  providers: [CostCodesService, CostReportService, CostCommitmentsService],
  exports: [CostCodesService, CostCommitmentsService],
})
export class CostCodesModule {}
