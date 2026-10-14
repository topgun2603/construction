import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  publicApiAttendanceQuerySchema,
  publicApiExpenseCreateSchema,
  publicApiExpenseQuerySchema,
  publicApiListQuerySchema,
  publicApiProjectScopedQuerySchema,
  type PublicApiAttendanceQuery,
  type PublicApiExpenseCreateInput,
  type PublicApiExpenseQuery,
  type PublicApiListQuery,
  type PublicApiProjectScopedQuery,
} from '@sitebook/shared';
import { Public } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ApiKeyGuard, PublicScope, type ApiKeyPrincipal, type PublicApiRequest } from './api-key.guard';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { publicOpenApiDocument } from './openapi';
import { PublicApiService } from './public-api.service';

/** Set by ApiKeyGuard on every route below; read through this so a handler cannot forget it. */
function principal(request: PublicApiRequest): ApiKeyPrincipal {
  return request.apiKey!;
}

/**
 * `/public/v1` — the public REST API (roadmap Phase 3). Documented route for route in `openapi.ts`
 * (the e2e suite fails if a route here is missing from it) and rendered at `/developers/docs`.
 *
 * `@Public()` only takes it out of the session guard: every route is authenticated by
 * `ApiKeyGuard`, which takes API keys and nothing else. `@SkipThrottle()` because the per-IP
 * throttle is the internal API's; keys have their own per-key limit in the guard.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@UseGuards(ApiKeyGuard)
@UseInterceptors(IdempotencyInterceptor)
@Controller('public/v1')
export class PublicApiController {
  constructor(private readonly api: PublicApiService) {}

  /** Which key this is and what it may do — the first call an integration makes. */
  @Get('key')
  key(@Req() request: PublicApiRequest) {
    const key = principal(request);
    return {
      id: key.id,
      name: key.name,
      scopes: key.scopes,
      company: { id: key.tenantId, currency: key.tenant.currency, timezone: key.tenant.timezone, country: key.tenant.country },
    };
  }

  @Get('projects')
  @PublicScope('projects:read', 'projects')
  listProjects(@Req() request: PublicApiRequest, @Query(zodBody(publicApiListQuerySchema)) query: PublicApiListQuery) {
    return this.api.listProjects(principal(request), query);
  }

  @Get('projects/:id')
  @PublicScope('projects:read', 'projects')
  getProject(@Req() request: PublicApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.getProject(principal(request), id);
  }

  @Get('projects/:id/cost-report')
  @PublicScope('cost_report:read', 'projects')
  costReport(@Req() request: PublicApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.costReport(principal(request), id);
  }

  @Get('workers')
  @PublicScope('workers:read', 'labour')
  listWorkers(@Req() request: PublicApiRequest, @Query(zodBody(publicApiListQuerySchema)) query: PublicApiListQuery) {
    return this.api.listWorkers(principal(request), query);
  }

  @Get('workers/:id')
  @PublicScope('workers:read', 'labour')
  getWorker(@Req() request: PublicApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.getWorker(principal(request), id);
  }

  @Get('attendance')
  @PublicScope('attendance:read', 'attendance')
  listAttendance(
    @Req() request: PublicApiRequest,
    @Query(zodBody(publicApiAttendanceQuerySchema)) query: PublicApiAttendanceQuery,
  ) {
    return this.api.listAttendance(principal(request), query);
  }

  @Get('expenses')
  @PublicScope('expenses:read', 'expenses')
  listExpenses(@Req() request: PublicApiRequest, @Query(zodBody(publicApiExpenseQuerySchema)) query: PublicApiExpenseQuery) {
    return this.api.listExpenses(principal(request), query);
  }

  @Get('expenses/:id')
  @PublicScope('expenses:read', 'expenses')
  getExpense(@Req() request: PublicApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.getExpense(principal(request), id);
  }

  @Post('expenses')
  @HttpCode(HttpStatus.CREATED)
  @PublicScope('expenses:write', 'expenses')
  createExpense(
    @Req() request: PublicApiRequest,
    @Body(zodBody(publicApiExpenseCreateSchema)) body: PublicApiExpenseCreateInput,
  ) {
    return this.api.createExpense(principal(request), body);
  }

  @Get('purchase-orders')
  @PublicScope('purchase_orders:read')
  listPurchaseOrders(
    @Req() request: PublicApiRequest,
    @Query(zodBody(publicApiProjectScopedQuerySchema)) query: PublicApiProjectScopedQuery,
  ) {
    return this.api.listPurchaseOrders(principal(request), query);
  }

  @Get('purchase-orders/:id')
  @PublicScope('purchase_orders:read')
  getPurchaseOrder(@Req() request: PublicApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.getPurchaseOrder(principal(request), id);
  }

  @Get('daily-reports')
  @PublicScope('daily_reports:read', 'dpr')
  listDailyReports(
    @Req() request: PublicApiRequest,
    @Query(zodBody(publicApiProjectScopedQuerySchema)) query: PublicApiProjectScopedQuery,
  ) {
    return this.api.listDailyReports(principal(request), query);
  }

  @Get('change-orders')
  @PublicScope('change_orders:read')
  listChangeOrders(
    @Req() request: PublicApiRequest,
    @Query(zodBody(publicApiProjectScopedQuerySchema)) query: PublicApiProjectScopedQuery,
  ) {
    return this.api.listChangeOrders(principal(request), query);
  }

  @Get('rfis')
  @PublicScope('rfis:read')
  listRfis(@Req() request: PublicApiRequest, @Query(zodBody(publicApiProjectScopedQuerySchema)) query: PublicApiProjectScopedQuery) {
    return this.api.listRfis(principal(request), query);
  }
}

/**
 * The OpenAPI 3.1 document, open to anybody: it describes the API, holds no company data, and an
 * integrator reads it before they have a key. Cached for an hour by whoever fetches it.
 */
@ApiExcludeController()
@Public()
@Controller('public/v1')
export class PublicApiDocsController {
  @Get('openapi.json')
  @Header('Cache-Control', 'public, max-age=3600')
  openapi() {
    return publicOpenApiDocument();
  }
}
