import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ssoCompleteSchema,
  ssoStartSchema,
  type SsoCompleteInput,
  type SsoStartInput,
} from '@sitebook/shared';
import { Public } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SamlClientService } from './saml-client.service';
import { SsoLoginService } from './sso-login.service';

/**
 * The public half of single sign-on: everything a person reaches before they have a session.
 * Throttled like `/auth/exchange`, because each of these makes us do network or signature work for
 * an unauthenticated caller.
 */
@ApiTags('auth')
@Controller('auth/sso')
export class SsoAuthController {
  constructor(
    private readonly login: SsoLoginService,
    private readonly saml: SamlClientService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Begin single sign-on for a work email' })
  async start(@Body(zodBody(ssoStartSchema)) body: SsoStartInput) {
    return this.login.start(body);
  }

  /** Where an OpenID Connect provider sends the browser back with `code` and `state`. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('oidc/callback')
  @ApiOperation({ summary: 'OpenID Connect redirect URI' })
  async oidcCallback(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    redirect(res, await this.login.oidcCallback(query));
  }

  /** The SAML Assertion Consumer Service: the provider's auto-submitted form lands here. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('saml/:tenantId/acs')
  @ApiOperation({ summary: 'SAML assertion consumer service' })
  async samlAcs(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    redirect(res, await this.login.samlAcs(tenantId, body ?? {}));
  }

  /**
   * Our SP metadata for one company. Public because a provider fetches it by URL, and because it
   * holds nothing secret — an entity id and an ACS URL.
   */
  @Public()
  @Get('saml/:tenantId/metadata')
  @Header('Content-Type', 'application/samlmetadata+xml; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="buildr-sp-metadata.xml"')
  @ApiOperation({ summary: 'SAML service provider metadata' })
  metadata(@Param('tenantId', ParseUUIDPipe) tenantId: string): string {
    return this.saml.serviceProviderMetadata(tenantId);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Swap a single sign-on ticket for a session' })
  async complete(
    @Body(zodBody(ssoCompleteSchema)) body: SsoCompleteInput,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.login.complete(body, userAgent);
  }
}

/**
 * 303 so the browser follows a POST (the SAML form) with a GET. `no-store` and `no-referrer`
 * because the URL carries a one-time ticket in its fragment, and nothing about it should linger.
 */
function redirect(res: Response, url: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(HttpStatus.SEE_OTHER, url);
}
