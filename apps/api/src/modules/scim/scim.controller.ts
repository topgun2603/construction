import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  SCIM_MAX_PAGE_SIZE,
  SCIM_SCHEMA_GROUP,
  SCIM_SCHEMA_RESOURCE_TYPE,
  SCIM_SCHEMA_SP_CONFIG,
  SCIM_SCHEMA_USER,
} from '@sitebook/shared';
import { Public } from '../../common/decorators';
import { ScimAuthGuard, type ScimRequest } from './scim-auth.guard';
import { ScimError, ScimExceptionFilter } from './scim-error';
import { ScimService } from './scim.service';

type Body = Record<string, unknown>;
type ListQuery = { filter?: string; startIndex?: string; count?: string; excludedAttributes?: string };

/**
 * `/v1/scim/v2` — SCIM 2.0 for Microsoft Entra ID and Okta provisioning.
 *
 * `@Public()` only takes it out of the session guard: SCIM has its own credential, the company's
 * bearer token, checked by `ScimAuthGuard` on every route. Throttled more generously than sign-in
 * because a first provisioning cycle sends a request per person, in a burst.
 */
@ApiExcludeController()
@Public()
@UseGuards(ScimAuthGuard)
@UseFilters(ScimExceptionFilter)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('scim/v2')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Get('ServiceProviderConfig')
  @Header('Content-Type', 'application/scim+json')
  serviceProviderConfig() {
    return {
      schemas: [SCIM_SCHEMA_SP_CONFIG],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: SCIM_MAX_PAGE_SIZE },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer token',
          description: 'The token generated in BUILDR under Settings → Security → Single sign-on',
          primary: true,
        },
      ],
      meta: { resourceType: 'ServiceProviderConfig' },
    };
  }

  @Get('ResourceTypes')
  @Header('Content-Type', 'application/scim+json')
  resourceTypes() {
    const types = [
      { id: 'User', name: 'User', endpoint: '/Users', schema: SCIM_SCHEMA_USER },
      { id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCIM_SCHEMA_GROUP },
    ].map((type) => ({ schemas: [SCIM_SCHEMA_RESOURCE_TYPE], ...type, meta: { resourceType: 'ResourceType' } }));
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: types.length,
      startIndex: 1,
      itemsPerPage: types.length,
      Resources: types,
    };
  }

  // --- Users -----------------------------------------------------------------------------------

  @Get('Users')
  @Header('Content-Type', 'application/scim+json')
  listUsers(@Req() req: ScimRequest, @Query() query: ListQuery) {
    return this.scim.listUsers(tenantOf(req), query);
  }

  @Get('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  getUser(@Req() req: ScimRequest, @Param('id') id: string) {
    return this.scim.getUser(tenantOf(req), id);
  }

  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  @Header('Content-Type', 'application/scim+json')
  createUser(@Req() req: ScimRequest, @Body() body: Body) {
    return this.scim.createUser(tenantOf(req), body ?? {});
  }

  @Put('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  replaceUser(@Req() req: ScimRequest, @Param('id') id: string, @Body() body: Body) {
    return this.scim.replaceUser(tenantOf(req), id, body ?? {});
  }

  @Patch('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  patchUser(@Req() req: ScimRequest, @Param('id') id: string, @Body() body: Body) {
    return this.scim.patchUser(tenantOf(req), id, body ?? {});
  }

  @Delete('Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(@Req() req: ScimRequest, @Param('id') id: string): Promise<void> {
    await this.scim.deleteUser(tenantOf(req), id);
  }

  // --- Groups ----------------------------------------------------------------------------------

  @Get('Groups')
  @Header('Content-Type', 'application/scim+json')
  listGroups(@Req() req: ScimRequest, @Query() query: ListQuery) {
    return this.scim.listGroups(tenantOf(req), query);
  }

  @Get('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  getGroup(@Req() req: ScimRequest, @Param('id') id: string) {
    return this.scim.getGroup(tenantOf(req), id);
  }

  @Post('Groups')
  @HttpCode(HttpStatus.CREATED)
  @Header('Content-Type', 'application/scim+json')
  createGroup(@Req() req: ScimRequest, @Body() body: Body) {
    return this.scim.createGroup(tenantOf(req), body ?? {});
  }

  @Put('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  replaceGroup(@Req() req: ScimRequest, @Param('id') id: string, @Body() body: Body) {
    return this.scim.replaceGroup(tenantOf(req), id, body ?? {});
  }

  @Patch('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  patchGroup(@Req() req: ScimRequest, @Param('id') id: string, @Body() body: Body) {
    return this.scim.patchGroup(tenantOf(req), id, body ?? {});
  }

  @Delete('Groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGroup(@Req() req: ScimRequest, @Param('id') id: string): Promise<void> {
    await this.scim.deleteGroup(tenantOf(req), id);
  }
}

/** Set by `ScimAuthGuard`; its absence means the guard did not run, which must fail closed. */
function tenantOf(req: ScimRequest): string {
  if (!req.scim) throw new ScimError(HttpStatus.UNAUTHORIZED, 'A valid SCIM bearer token is required');
  return req.scim.tenantId;
}
