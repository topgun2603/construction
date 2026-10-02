import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  // `UploadsModule` for the bill's bytes, `AiModule` for reading them.
  imports: [AiModule, UploadsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
