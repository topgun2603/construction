import { Global, Module } from '@nestjs/common';
import { AiGateway } from './ai-gateway.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';

/**
 * Company-level AI controls (roadmap Phase 3, "AI data controls").
 *
 * Global because the gateway is the only way to a model client and its callers are everywhere —
 * the AI module's readers, the forecast explainer, the document upload and the background worker
 * that indexes documents. Importing it module by module would make "forgot the import" a reason to
 * reach for the vendor SDK directly, which is the one thing this exists to prevent.
 */
@Global()
@Module({
  controllers: [AiSettingsController],
  providers: [AiGateway, AiSettingsService],
  exports: [AiGateway, AiSettingsService],
})
export class AiControlsModule {}
