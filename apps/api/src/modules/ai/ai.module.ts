import { Module } from '@nestjs/common';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';
import { BillReader } from './bill-reader.service';
import { DocumentQaService } from './document-qa.service';
import { VoiceReader } from './voice-reader.service';

/**
 * Everything that asks a model a question.
 *
 * One module so there is one place to look for what this product sends to a vendor, and one place
 * to turn it off. Nothing here writes to the database — these services return drafts and sentences
 * that a person or a deterministic service then acts on.
 */
@Module({
  controllers: [AskController],
  providers: [AskService, BillReader, VoiceReader, DocumentQaService],
  exports: [AskService, BillReader, VoiceReader, DocumentQaService],
})
export class AiModule {}
