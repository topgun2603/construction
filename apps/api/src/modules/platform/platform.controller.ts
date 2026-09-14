import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  createPlanSchema,
  createTenantPlatformSchema,
  deleteTenantSchema,
  updatePlanSchema,
  grantOperatorSchema,
  listTenantsQuerySchema,
  platformLoginSchema,
  updateTenantPlatformSchema,
  type CreatePlanInput,
  type CreateTenantPlatformInput,
  type DeleteTenantInput,
  type UpdatePlanInput,
  type GrantOperatorInput,
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
import { PlansService } from '../plans/plans.service';
import { PlatformOperators } from './platform-operators.service';
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
    private readonly operators: PlatformOperators,
    private readonly plans: PlansService,
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
    const phone = actor(request);
    // `root` drives the console's own UI: an operator who cannot grant access should not be shown
    // the controls for it and then refused by the server.
    return { phone, root: this.operators.isRoot(phone) };
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

  /**
   * Only a root operator. Creating an account is the one console action that makes a customer
   * rather than changing one, and it is not support work.
   */
  @UseGuards(PlatformGuard)
  @Post('tenants')
  @ApiOperation({ summary: 'Create an account without anybody signing up' })
  createTenant(
    @Req() request: PlatformRequest,
    @Body(zodBody(createTenantPlatformSchema)) body: CreateTenantPlatformInput,
  ) {
    const phone = this.assertRoot(request);
    return this.platform.createTenant(phone, body);
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

  /**
   * Read-only, and not impersonation.
   *
   * Minting a tenant token for a support person would put them inside a customer's account with
   * that customer's permissions and nothing in the tenant's own audit log to say it was not them.
   * This answers the same questions without becoming anybody.
   */
  @UseGuards(PlatformGuard)
  @Get('tenants/:id/support')
  @ApiOperation({ summary: 'What an operator needs to answer a support call' })
  support(@Req() request: PlatformRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.supportView(actor(request), id);
  }

  @UseGuards(PlatformGuard)
  @Get('tenants/:id/export')
  @ApiOperation({ summary: 'Everything this tenant owns, as JSON' })
  exportTenant(@Req() request: PlatformRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.exportTenant(actor(request), id);
  }

  /**
   * A DELETE with a body, which is unusual but right here: the confirmation is the tenant's own
   * name, and a name in a query string ends up in access logs and browser history.
   */
  @UseGuards(PlatformGuard)
  @Delete('tenants/:id')
  @ApiOperation({ summary: 'Remove a tenant and everything under it, permanently' })
  deleteTenant(
    @Req() request: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(deleteTenantSchema)) body: DeleteTenantInput,
  ) {
    return this.platform.deleteTenant(actor(request), id, body.confirm_name);
  }

  /**
   * The catalogue, including what has been retired — an operator needs to see the plan an account
   * is on even after it stopped being sold.
   */
  @UseGuards(PlatformGuard)
  @Get('plans')
  @ApiOperation({ summary: 'Every plan, on sale or retired' })
  async listPlans() {
    return { items: await this.plans.listAll() };
  }

  /**
   * Root operators only, like creating an account. A price is the one number in this console that
   * somebody outside the company should never be able to set.
   */
  @UseGuards(PlatformGuard)
  @Post('plans')
  @ApiOperation({ summary: 'Add a plan' })
  createPlan(
    @Req() request: PlatformRequest,
    @Body(zodBody(createPlanSchema)) body: CreatePlanInput,
  ) {
    this.assertRoot(request);
    return this.plans.create(body);
  }

  @UseGuards(PlatformGuard)
  @Patch('plans/:id')
  @ApiOperation({ summary: 'Change what a plan says or costs' })
  updatePlan(
    @Req() request: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updatePlanSchema)) body: UpdatePlanInput,
  ) {
    this.assertRoot(request);
    return this.plans.update(id, body);
  }

  @UseGuards(PlatformGuard)
  @Delete('plans/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a plan nobody is on' })
  async deletePlan(
    @Req() request: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    this.assertRoot(request);
    await this.plans.remove(id, (code) => this.platform.tenantsOnPlan(code));
  }

  @UseGuards(PlatformGuard)
  @Get('operators')
  @ApiOperation({ summary: 'Who may use the console' })
  listOperators() {
    return this.operators.list().then((items) => ({ items }));
  }

  @UseGuards(PlatformGuard)
  @Post('operators')
  @ApiOperation({ summary: 'Grant console access to a number' })
  grantOperator(
    @Req() request: PlatformRequest,
    @Body(zodBody(grantOperatorSchema)) body: GrantOperatorInput,
  ) {
    return this.operators.grant(actor(request), body);
  }

  @UseGuards(PlatformGuard)
  @Delete('operators/:phone')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw console access' })
  async revokeOperator(
    @Req() request: PlatformRequest,
    @Param('phone') phone: string,
  ): Promise<void> {
    await this.operators.revoke(actor(request), phone);
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

  /**
   * Refuses anybody who is not named in the deployment config, and returns who they are.
   *
   * Creating accounts and pricing them are the two things in this console that make a business
   * rather than support one, and neither is support work.
   */
  private assertRoot(request: PlatformRequest): string {
    const phone = actor(request);
    if (!this.operators.isRoot(phone)) {
      throw ApiError.forbidden('Only an operator named in the deployment config can do that');
    }
    return phone;
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
