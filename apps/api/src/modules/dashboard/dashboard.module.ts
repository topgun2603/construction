import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  // For the overrun alert: the dashboard reads the stock report rather than recomputing it.
  imports: [StockModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
