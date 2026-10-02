import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DprController } from './dpr.controller';
import { DprService } from './dpr.service';

@Module({
  // `UploadsModule` for a voice note's bytes, `AiModule` for listening to them.
  imports: [AiModule, UploadsModule],
  controllers: [DprController],
  providers: [DprService],
  exports: [DprService],
})
export class DprModule {}
