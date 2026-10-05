import { Module } from '@nestjs/common';
import { BoqBillsService } from './boq-bills.service';
import { BoqController } from './boq.controller';
import { BoqMeasurementsService } from './boq-measurements.service';
import { BoqService } from './boq.service';

/**
 * Bill of quantities (roadmap Phase 2, module 5). Writes into client billing's payment schedule when
 * a bill is invoiced, through the shared tables rather than by importing that module: client billing
 * never needs to know a BOQ exists beyond refusing to edit an instalment one raised.
 */
@Module({
  controllers: [BoqController],
  providers: [BoqService, BoqMeasurementsService, BoqBillsService],
})
export class BoqModule {}
