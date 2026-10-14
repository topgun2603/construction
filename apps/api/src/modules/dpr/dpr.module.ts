import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ChangeOrdersModule } from '../change-orders/change-orders.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DprController } from './dpr.controller';
import { DprService } from './dpr.service';

@Module({
  // `UploadsModule` for a voice note's bytes, `AiModule` for listening to them.
  // `ChangeOrdersModule` for the scope-creep catcher, which reads each submitted report.
  imports: [AiModule, UploadsModule, ChangeOrdersModule],
  controllers: [DprController],
  providers: [DprService],
  exports: [DprService],
})
export class DprModule {}
