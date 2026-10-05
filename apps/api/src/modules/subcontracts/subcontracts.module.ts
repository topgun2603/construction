import { Module } from '@nestjs/common';
import { CostCodesModule } from '../cost-codes/cost-codes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RaBillsService } from './ra-bills.service';
import { SubcontractCostsService } from './subcontract-costs.service';
import { SubcontractsController } from './subcontracts.controller';
import { SubcontractsService } from './subcontracts.service';

/**
 * Subcontracts and progress (RA) billing (roadmap Phase 2, module 3). Registers itself with cost
 * codes as a source of committed and actual cost; cost codes never imports this module back.
 */
@Module({
  imports: [CostCodesModule, NotificationsModule],
  controllers: [SubcontractsController],
  providers: [SubcontractsService, RaBillsService, SubcontractCostsService],
})
export class SubcontractsModule {}
