import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createTenantSchema,
  inviteUserSchema,
  updateTenantSchema,
  type CreateTenantInput,
  type InviteUserInput,
  type UpdateTenantInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, Public, RequiresPermission } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * Onboarding. Public because the caller has no tenant yet — authorisation is the
   * `X-Onboarding-Token` issued by `/auth/exchange` for a verified phone.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Create a tenant and its owner' })
  async create(
    @Body(zodBody(createTenantSchema)) body: CreateTenantInput,
    @Headers('x-onboarding-token') onboardingToken?: string,
    @Headers('x-device-id') deviceId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (!onboardingToken) throw ApiError.unauthenticated('X-Onboarding-Token header is required');
    return this.tenants.onboard(onboardingToken, body, { deviceId, userAgent });
  }

  /** The current tenant. There is no `GET /tenants/:id` — the id is in the token. */
  @Get('current')
  @ApiOperation({ summary: 'Read the current tenant' })
  async current(@CurrentUser() user: RequestUser) {
    return this.tenants.get(user.tenantId);
  }

  @RequiresPermission('tenant.manage')
  @Patch('current')
  @ApiOperation({ summary: 'Update the current tenant' })
  async update(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(updateTenantSchema)) body: UpdateTenantInput,
  ) {
    return this.tenants.update(user.tenantId, body);
  }

  @RequiresPermission('team.manage')
  @Post('current/invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a team member by phone number' })
  async invite(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(inviteUserSchema)) body: InviteUserInput,
  ) {
    return this.tenants.invite(user, body);
  }

  @RequiresPermission('team.manage', 'projects.manage', 'wages.view')
  @Get('current/team')
  @ApiOperation({ summary: 'List team members' })
  async team(@CurrentUser() user: RequestUser) {
    return this.tenants.listTeam(user.tenantId);
  }

  @RequiresPermission('team.manage')
  @Delete('current/team/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a team member' })
  async removeTeamMember(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.tenants.removeTeamMember(user, userId);
  }

}
