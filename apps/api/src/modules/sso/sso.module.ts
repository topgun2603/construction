import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OidcClientService } from './oidc-client.service';
import { SamlClientService } from './saml-client.service';
import { SsoAuthController } from './sso-auth.controller';
import { SsoConfigService } from './sso-config.service';
import { SsoLoginService } from './sso-login.service';
import { SsoSettingsController } from './sso-settings.controller';
import { SsoSettingsService } from './sso-settings.service';

/** Single sign-on (roadmap Phase 3, item 1): settings, and the OIDC and SAML sign-in flows. */
@Module({
  imports: [AuthModule],
  controllers: [SsoAuthController, SsoSettingsController],
  providers: [SsoConfigService, OidcClientService, SamlClientService, SsoLoginService, SsoSettingsService],
  exports: [SsoConfigService],
})
export class SsoModule {}
