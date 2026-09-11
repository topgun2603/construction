import { Module } from '@nestjs/common';
import { IndentsController } from './indents.controller';
import { IndentsService } from './indents.service';

@Module({
  controllers: [IndentsController],
  providers: [IndentsService],
  exports: [IndentsService],
})
export class IndentsModule {}
