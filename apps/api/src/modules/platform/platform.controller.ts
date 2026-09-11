import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  listTenantsQuerySchema,
  platformLoginSchema,
  updateTenantPlatformSchema,
  type ListTenantsQuery,
  type PlatformLoginInput,
  type UpdateTenantPlatformInput,
} from '@sitebook/shared';
import { Public } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { PlatformAnalytics } from './platform-analytics.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformGuard, type PlatformRequest } from './platform.guard';
import { PlatformService } from './platform.service';

/**
 * The platform console API (spec §6.1: "Superadmin operations use a separate role that
 * bypasses RLS and is never exposed through the public API").
 *
 * `@Public()` on this controller means only that the *tenant* guard skips it — these
 * requests carry no tenant_id and would be rejected for that alone. `PlatformGuard`
 * is what authenticates them, and it is stricter: a platform-audience token whose phone
 * is still on the env allowlist, on a deployment where the console is configured at all.
 */
@ApiTags('platform')
@Public()
@Controller('admin')
export class PlatformController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly platform: PlatformService,
    private readonly analytics: PlatformAnalytics,
  ) {}

  /**
   * Rate limited hard. This endpoint tells an attacker whether a phone number is a
   * platform administrator, and the OTP in front of it does not slow down someone
   * working through a list of numbers they already control.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/login')
  @ApiOperation({ summary: 'Sign in to the platform console' })
  login(@Body(zodBody(platformLoginSchema)) body: PlatformLoginInput) {
    return this.auth.login(body);
  }

  @UseGuards(PlatformGuard)
  @Get('me')
  @ApiOperation({ summary: 'Who the console thinks you are' })
  me(@Req() request: PlatformRequest) {
    return { phone: actor(request) };
  }

  @UseGuards(PlatformGuard)
  @Get('metrics')
  @ApiOperation({ summary: 'Platform-wide counts' })
  metrics() {
    return this.platform.metrics();
  }

  @UseGuards(PlatformGuard)
  @Get('tenants')
  @ApiOperation({ summary: 'Every tenant, with usage counts' })
  tenants(@Query(zodBody(listTenantsQuerySchema)) query: ListTenantsQuery) {
    return this.platform.listTenants(query);
  }

  @UseGuards(PlatformGuard)
  @Get('tenants/:id')
  @ApiOperation({ summary: 'One tenant in detail' })
  tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getTenant(id);
  }

  @UseGuards(PlatformGuard)
  @Patch('tenants/:id')
  @ApiOperation({ summary: 'Change a plan, module list or status' })
  updateTenant(
    @Req() request: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateTenantPlatformSchema)) body: UpdateTenantPlatformInput,
  ) {
    return this.platform.updateTenant(actor(request), id, body);
  }

  @UseGuards(PlatformGuard)
  @Get('audit')
  @ApiOperation({ summary: 'What the console has done, newest first' })
  audit() {
    return this.platform.auditTrail();
  }

  /**
   * `weeks` is clamped rather than rejected: this is a dashboard control, and a nonsense
   * value in a bookmarked URL should show a sensible window instead of an error page.
   */
  @UseGuards(PlatformGuard)
  @Get('analytics')
  @ApiOperation({ summary: 'Growth, activation funnel, engagement and dormancy' })
  analyticsOverview(@Query('weeks') weeks?: string) {
    const parsed = Number.parseInt(weeks ?? '', 10);
    const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 4), 52) : 12;
    return this.analytics.overview(clamped);
  }
}

/**
 * The guard sets this; if it is missing the guard did not run, which means a route was
 * added without `@UseGuards(PlatformGuard)`. Throwing is the only safe response — the
 * alternative is attributing an audit entry to nobody.
 */
function actor(request: PlatformRequest): string {
  const phone = request.platformAdmin?.phone;
  if (!phone) throw ApiError.unauthenticated();
  return phone;
}
