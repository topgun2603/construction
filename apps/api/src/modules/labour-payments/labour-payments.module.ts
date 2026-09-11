import { Module } from '@nestjs/common';
import { LabourPaymentsController } from './labour-payments.controller';
import { LabourPaymentsService } from './labour-payments.service';

@Module({
  controllers: [LabourPaymentsController],
  providers: [LabourPaymentsService],
  exports: [LabourPaymentsService],
})
export class LabourPaymentsModule {}
