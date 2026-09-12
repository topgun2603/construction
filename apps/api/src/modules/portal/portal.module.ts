import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { ApprovalsService } from './approvals.service';
import { ClientBillingService } from './client-billing.service';
import { DocumentsService } from './documents.service';
import { MessagesService } from './messages.service';
import {
  ApprovalsController,
  ClientPaymentsController,
  PaymentScheduleController,
  PaymentStagesController,
  ProjectApprovalsController,
} from './client-billing.controller';
import {
  DocumentsController,
  MessagesController,
  SiteMessagesController,
} from './portal.controller';

/**
 * The client's half of a job: what they are told, what they are shown, what they owe and what they
 * have signed off.
 */
@Module({
  // These sign URLs for what they hand back: attachments, documents and the drawing attached to an
  // approval all stay private objects.
  imports: [UploadsModule],
  controllers: [
    SiteMessagesController,
    MessagesController,
    DocumentsController,
    PaymentScheduleController,
    PaymentStagesController,
    ClientPaymentsController,
    ApprovalsController,
    ProjectApprovalsController,
  ],
  providers: [MessagesService, DocumentsService, ClientBillingService, ApprovalsService],
})
export class PortalModule {}
