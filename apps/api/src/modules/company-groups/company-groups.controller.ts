import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  companyGroupAdminSchema,
  companyGroupInviteSchema,
  companyGroupRateSchema,
  companyGroupReportQuerySchema,
  createCompanyGroupSchema,
  updateCompanyGroupSchema,
  type CompanyGroupAdminInput,
  type CompanyGroupInviteInput,
  type CompanyGroupRateInput,
  type CompanyGroupReportQuery,
  type CreateCompanyGroupInput,
  type UpdateCompanyGroupInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CompanyGroupReportService } from './company-group-report.service';
import { CompanyGroupsService } from './company-groups.service';

/**
 * Company groups (Phase 2, module 11).
 *
 * No `@RequiresPermission` on these routes, deliberately: tenant role permissions say what a person
 * may do *inside* a company, and none of them should imply anything about a group. The service
 * checks the two things that do — being the company's owner, or holding a group grant — on every
 * call, against the database rather than the token.
 *
 * `current` is always the caller's own company's group. No route takes a group id: which group a
 * request may touch is derived from the company its token is for.
 */
@ApiTags('company-groups')
@Controller('company-groups')
export class CompanyGroupsController {
  constructor(
    private readonly groups: CompanyGroupsService,
    private readonly reports: CompanyGroupReportService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: 'This company’s group, its companies, admins, invitations and rates' })
  overview(@CurrentUser() user: RequestUser) {
    return this.groups.overview(user);
  }

  @Post()
  @ApiOperation({ summary: 'Start a group with this company in it (owner only)' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createCompanyGroupSchema)) body: CreateCompanyGroupInput,
  ) {
    return this.groups.create(user, body);
  }

  @Patch('current')
  @ApiOperation({ summary: 'Rename the group or change its currency (group.manage)' })
  update(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(updateCompanyGroupSchema)) body: UpdateCompanyGroupInput,
  ) {
    return this.groups.update(user, body);
  }

  @Post('current/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take this company out of its group (owner only)' })
  async leave(@CurrentUser() user: RequestUser): Promise<void> {
    await this.groups.leave(user);
  }

  @Post('current/invitations')
  @ApiOperation({ summary: 'Invite a company by id or by its owner’s number (group.manage)' })
  invite(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(companyGroupInviteSchema)) body: CompanyGroupInviteInput,
  ) {
    return this.groups.invite(user, body);
  }

  @Delete('current/invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a pending invitation (group.manage)' })
  async cancelInvitation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.groups.cancelInvitation(user, id);
  }

  @Post('invitations/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation addressed to this company (owner only)' })
  accept(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.accept(user, id);
  }

  @Post('invitations/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Decline an invitation addressed to this company (owner only)' })
  async decline(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.groups.decline(user, id);
  }

  @Post('current/admins')
  @ApiOperation({ summary: 'Make a person in a group company a group admin (group.manage)' })
  grantAdmin(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(companyGroupAdminSchema)) body: CompanyGroupAdminInput,
  ) {
    return this.groups.grantAdmin(user, body);
  }

  @Delete('current/admins/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a group admin (group.manage)' })
  async revokeAdmin(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.groups.revokeAdmin(user, id);
  }

  @Get('current/rates')
  @ApiOperation({ summary: 'The group’s manual exchange rates (group admins)' })
  rates(@CurrentUser() user: RequestUser) {
    return this.groups.listRates(user);
  }

  @Post('current/rates')
  @ApiOperation({ summary: 'Set a currency’s rate from a date (group.manage)' })
  setRate(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(companyGroupRateSchema)) body: CompanyGroupRateInput,
  ) {
    return this.groups.setRate(user, body);
  }

  @Delete('current/rates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an exchange rate (group.manage)' })
  async removeRate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.groups.removeRate(user, id);
  }

  @Get('current/report')
  @ApiOperation({ summary: 'Consolidated figures per company and for the group (group.view_reports)' })
  report(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(companyGroupReportQuerySchema)) query: CompanyGroupReportQuery,
  ) {
    return this.reports.report(user, query);
  }

  @Get('current/report/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="group-report.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The consolidated report as CSV (group.view_reports)' })
  reportCsv(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(companyGroupReportQuerySchema)) query: CompanyGroupReportQuery,
  ) {
    return this.reports.reportCsv(user, query);
  }
}
