import { Module } from '@nestjs/common';
import { BillReader } from './bill-reader.service';

/**
 * Everything that asks a model a question.
 *
 * One module so there is one place to look for what this product sends to a vendor, and one place
 * to turn it off. Nothing here writes to the database — these services return drafts and sentences
 * that a person or a deterministic service then acts on.
 */
@Module({
  providers: [BillReader],
  exports: [BillReader],
})
export class AiModule {}
