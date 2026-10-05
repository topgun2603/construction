import { Module } from '@nestjs/common';
import { CostCodesModule } from '../cost-codes/cost-codes.module';
import { ApprovalLimitsService } from './approval-limits.service';
import { ProcurementController } from './procurement.controller';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { RfqsService } from './rfqs.service';
import { VendorsService } from './vendors.service';

/**
 * Procurement (roadmap Phase 2, module 2): suppliers, quotes, purchase orders with approval limits,
 * goods received into stock, and supplier invoices matched three ways into expenses.
 *
 * Imports `CostCodesModule` for `CostCommitmentsService`: purchase orders register themselves as
 * what the cost report calls "committed".
 */
@Module({
  imports: [CostCodesModule],
  controllers: [ProcurementController],
  providers: [
    VendorsService,
    ApprovalLimitsService,
    PurchaseOrdersService,
    RfqsService,
    PurchaseInvoicesService,
  ],
  exports: [PurchaseOrdersService],
})
export class ProcurementModule {}
