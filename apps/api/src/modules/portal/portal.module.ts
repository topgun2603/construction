import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { DocumentsService } from './documents.service';
import { MessagesService } from './messages.service';
import {
  DocumentsController,
  MessagesController,
  SiteMessagesController,
} from './portal.controller';

@Module({
  // Both sign URLs for what they hand back: attachments and documents stay private objects.
  imports: [UploadsModule],
  controllers: [SiteMessagesController, MessagesController, DocumentsController],
  providers: [MessagesService, DocumentsService],
})
export class PortalModule {}
