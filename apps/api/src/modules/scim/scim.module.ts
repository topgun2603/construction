import { Module } from '@nestjs/common';
import { SsoModule } from '../sso/sso.module';
import { ScimAuthGuard } from './scim-auth.guard';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';

/** SCIM 2.0 user provisioning, authenticated by each company's own bearer token. */
@Module({
  imports: [SsoModule],
  controllers: [ScimController],
  providers: [ScimService, ScimAuthGuard],
})
export class ScimModule {}
