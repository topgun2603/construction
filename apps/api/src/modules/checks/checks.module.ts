import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';

@Module({
  controllers: [ChecksController],
  providers: [ChecksService],
  // The nightly job runs the same checks the "run now" button does.
  exports: [ChecksService],
})
export class ChecksModule {}
