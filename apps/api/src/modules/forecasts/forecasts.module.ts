import { Module } from '@nestjs/common';
import { ForecastExplainer } from './forecast-explainer.service';
import { ForecastsController } from './forecasts.controller';
import { ForecastsService } from './forecasts.service';

@Module({
  controllers: [ForecastsController],
  providers: [ForecastsService, ForecastExplainer],
  // The nightly job runs the same service the refresh button does.
  exports: [ForecastsService],
})
export class ForecastsModule {}
