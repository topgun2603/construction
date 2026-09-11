import { Module } from '@nestjs/common';
import { DprController } from './dpr.controller';
import { DprService } from './dpr.service';

@Module({
  controllers: [DprController],
  providers: [DprService],
  exports: [DprService],
})
export class DprModule {}
