import { Module } from '@nestjs/common';
import { WagePeriodsController } from './wage-periods.controller';
import { WagePeriodsService } from './wage-periods.service';

@Module({
  controllers: [WagePeriodsController],
  providers: [WagePeriodsService],
  exports: [WagePeriodsService],
})
export class WagePeriodsModule {}
