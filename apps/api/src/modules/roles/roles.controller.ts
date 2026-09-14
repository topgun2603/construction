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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION_GROUPS,
  SYSTEM_ROLE_NOTES,
  assignRoleSchema,
  createRoleSchema,
  updateRoleSchema,
  type AssignRoleInput,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';

/**
 * Roles for one tenant.
 *
 * Listing is open to anyone who can manage the team, because the invite screen needs the
 * options; everything that changes a role needs `roles.manage`, which only the owner holds
 * by default.
 */
@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequiresPermission('roles.manage', 'team.manage')
  @Get()
  @ApiOperation({ summary: 'Roles in this tenant, built-in and custom' })
  list(@CurrentUser() user: RequestUser) {
    return this.roles.list(user);
  }

  /**
   * The permissions a role can be given, grouped and in the words a builder would use.
   *
   * Served rather than duplicated in each client. The web app imports `PERMISSION_GROUPS` from the
   * shared package directly, but the Flutter app cannot — and a second copy of sixty permission
   * strings written out in Dart would drift from this one the first time a permission was added,
   * leaving a role editor that silently cannot grant it.
   */
  @RequiresPermission('roles.manage')
  @Get('catalogue')
  @ApiOperation({ summary: 'Every permission, grouped, for a role editor' })
  catalogue() {
    return { groups: PERMISSION_GROUPS, base_role_notes: SYSTEM_ROLE_NOTES };
  }

  @RequiresPermission('roles.manage')
  @Post()
  @ApiOperation({ summary: 'Create a role' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createRoleSchema)) body: CreateRoleInput,
  ) {
    return this.roles.create(user, body);
  }

  @RequiresPermission('roles.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Rename a role or change its permissions' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateRoleSchema)) body: UpdateRoleInput,
  ) {
    return this.roles.update(user, id, body);
  }

  @RequiresPermission('roles.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role nobody holds' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.roles.remove(user, id);
  }

  /**
   * Moving a person between roles. Needs `team.manage` rather than `roles.manage`: this is
   * an act of administering people, not of defining what roles mean.
   */
  @RequiresPermission('team.manage')
  @Patch('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Put a team member on a different role' })
  async assign(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(zodBody(assignRoleSchema)) body: AssignRoleInput,
  ): Promise<void> {
    await this.roles.assign(user, userId, body.role_id);
  }
}
