import { Module } from '@nestjs/common';
import { CostCodesModule } from '../cost-codes/cost-codes.module';
import { CompanyGroupReportService } from './company-group-report.service';
import { CompanyGroupsController } from './company-groups.controller';
import { CompanyGroupsService } from './company-groups.service';

/**
 * Company groups (Phase 2, module 11). Imports cost codes for the committed and actual-cost
 * registries, so the consolidated report counts exactly what each company's own cost report does.
 */
@Module({
  imports: [CostCodesModule],
  controllers: [CompanyGroupsController],
  providers: [CompanyGroupsService, CompanyGroupReportService],
  // For deleting a company: it leaves its group the way an owner would (data-portability).
  exports: [CompanyGroupsService],
})
export class CompanyGroupsModule {}
