import { Global, Module } from '@nestjs/common';
import { RazorpayService } from './razorpay.service';
import { FcmService } from './fcm.service';
import { WhatsappService } from './whatsapp.service';

/** Outbound channels. Global because both the API and the worker send. */
@Global()
@Module({
  providers: [WhatsappService, FcmService, RazorpayService],
  exports: [WhatsappService, FcmService, RazorpayService],
})
export class IntegrationsModule {}
