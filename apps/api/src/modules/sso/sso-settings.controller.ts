import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  scimRoleMappingSchema,
  ssoConnectionSchema,
  ssoDomainSchema,
  ssoSamlMetadataSchema,
  type ScimRoleMappingInput,
  type SsoConnectionInput,
  type SsoDomainInput,
  type SsoSamlMetadataInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SsoSettingsService } from './sso-settings.service';

/**
 * Settings → Security → Single sign-on. `tenant.manage` at the route, and the service insists on
 * an owner on top — see `SsoSettingsService` for why the permission alone is not enough.
 */
@ApiTags('sso')
@RequiresPermission('tenant.manage')
@Controller('sso')
export class SsoSettingsController {
  constructor(private readonly settings: SsoSettingsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Single sign-on settings' })
  async overview(@CurrentUser() user: RequestUser) {
    return this.settings.overview(user);
  }

  @Put('connection')
  @ApiOperation({ summary: 'Save the single sign-on connection' })
  async saveConnection(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(ssoConnectionSchema)) body: SsoConnectionInput,
  ) {
    return this.settings.saveConnection(user, body);
  }

  @Post('saml/metadata')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read an identity provider’s SAML metadata into the form' })
  async importMetadata(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(ssoSamlMetadataSchema)) body: SsoSamlMetadataInput,
  ) {
    return this.settings.importSamlMetadata(user, body);
  }

  @Post('domains')
  @ApiOperation({ summary: 'Claim an email domain' })
  async addDomain(@CurrentUser() user: RequestUser, @Body(zodBody(ssoDomainSchema)) body: SsoDomainInput) {
    return this.settings.addDomain(user, body);
  }

  @Post('domains/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check the domain’s DNS TXT record' })
  async verifyDomain(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.verifyDomain(user, id);
  }

  @Delete('domains/:id')
  @ApiOperation({ summary: 'Remove a domain' })
  async removeDomain(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.removeDomain(user, id);
  }

  @Post('scim-token')
  @ApiOperation({ summary: 'Generate a SCIM token (revokes the previous one)' })
  async createScimToken(@CurrentUser() user: RequestUser) {
    return this.settings.createScimToken(user);
  }

  @Delete('scim-token')
  @ApiOperation({ summary: 'Revoke the SCIM token' })
  async revokeScimTokens(@CurrentUser() user: RequestUser) {
    return this.settings.revokeScimTokens(user);
  }

  @Post('role-mappings')
  @ApiOperation({ summary: 'Map a provider group to a role' })
  async addRoleMapping(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(scimRoleMappingSchema)) body: ScimRoleMappingInput,
  ) {
    return this.settings.addRoleMapping(user, body);
  }

  @Delete('role-mappings/:id')
  @ApiOperation({ summary: 'Remove a group mapping' })
  async removeRoleMapping(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.removeRoleMapping(user, id);
  }
}
