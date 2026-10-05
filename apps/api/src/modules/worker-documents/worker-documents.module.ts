import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { WorkerDocumentsController } from './worker-documents.controller';
import { WorkerDocumentsService } from './worker-documents.service';

@Module({
  imports: [UploadsModule, NotificationsModule],
  controllers: [WorkerDocumentsController],
  providers: [WorkerDocumentsService],
  // The morning job sends the expiry reminders through the same service.
  exports: [WorkerDocumentsService],
})
export class WorkerDocumentsModule {}
