import { Module } from '@nestjs/common';
import { CostCodesController } from './cost-codes.controller';
import { CostCodesService } from './cost-codes.service';
import { CostActualsService } from './cost-actuals.service';
import { CostCommitmentsService } from './cost-commitments.service';
import { CostReportService } from './cost-report.service';

/**
 * Cost codes and budgets. Exports `CostCommitmentsService` so purchase orders and subcontracts can
 * register what they commit against a code without this module having to know their tables, and
 * `CostActualsService` for cost booked through its own record (a certified subcontract bill).
 */
@Module({
  controllers: [CostCodesController],
  providers: [CostCodesService, CostReportService, CostCommitmentsService, CostActualsService],
  // The cost report too, for the public API's `GET /public/v1/projects/{id}/cost-report`.
  exports: [CostCodesService, CostCommitmentsService, CostActualsService, CostReportService],
})
export class CostCodesModule {}
