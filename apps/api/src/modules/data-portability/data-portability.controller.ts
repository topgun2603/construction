import {
  Body,
  Controller,
  Get,
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
  dataExportAnonymiseSchema,
  dataExportLegalAcceptSchema,
  dataExportPersonSearchSchema,
  deletionRequestSchema,
  type DataExportAnonymiseInput,
  type DataExportLegalAcceptInput,
  type DataExportPersonSearchInput,
  type DeletionRequestInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { AllowDuringDeletion, CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CompanyDeletionService } from './company-deletion.service';
import { DataExportService } from './data-export.service';
import { LegalService } from './legal.service';
import { PersonDataService } from './person-data.service';

/**
 * Settings → Company: the company's data — a full export, deleting the company, one person's data,
 * and the data processing agreement.
 *
 * `tenant.manage` at the route; each service insists on an owner on top (see `owner.ts`), as the
 * Security page and AI controls do.
 */
@ApiTags('data-portability')
@RequiresPermission('tenant.manage')
@Controller()
export class DataPortabilityController {
  constructor(
    private readonly exportsService: DataExportService,
    private readonly deletion: CompanyDeletionService,
    private readonly people: PersonDataService,
    private readonly legal: LegalService,
  ) {}

  // --- full export -------------------------------------------------------------------------------

  @Get('data-exports')
  @ApiOperation({ summary: 'The company’s exports, and whether another may be asked for' })
  listExports(@CurrentUser() user: RequestUser) {
    return this.exportsService.list(user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('data-exports')
  @ApiOperation({ summary: 'Ask for a full export of the company (built in the background)' })
  requestExport(@CurrentUser() user: RequestUser) {
    return this.exportsService.request(user);
  }

  @Get('data-exports/:id/download')
  @ApiOperation({ summary: 'A short-lived link to download a finished export' })
  downloadExport(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exportsService.download(user, id);
  }

  // --- deleting the company ----------------------------------------------------------------------

  @AllowDuringDeletion()
  @Get('company-deletion')
  @ApiOperation({ summary: 'Whether the company is scheduled for deletion, and what deleting needs' })
  deletionStatus(@CurrentUser() user: RequestUser) {
    return this.deletion.status(user);
  }

  /**
   * Throttled hard: the typed name is the only thing between this and the end of the company, and
   * there is no reason to try it more than a few times a minute.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('company-deletion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Schedule the company for deletion after a 30-day grace period' })
  requestDeletion(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(deletionRequestSchema)) body: DeletionRequestInput,
  ) {
    return this.deletion.request(user, body);
  }

  @AllowDuringDeletion()
  @Post('company-deletion/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a scheduled deletion and restore the company' })
  cancelDeletion(@CurrentUser() user: RequestUser) {
    return this.deletion.cancel(user);
  }

  // --- one person's data -------------------------------------------------------------------------

  @Get('people-data/search')
  @ApiOperation({ summary: 'Workers and team members by name or phone' })
  searchPeople(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(dataExportPersonSearchSchema)) query: DataExportPersonSearchInput,
  ) {
    return this.people.search(user, query.q);
  }

  @Get('people-data/workers/:id/export')
  @ApiOperation({ summary: 'Everything held about one worker, as a ZIP' })
  async exportWorker(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.people.exportPerson(user, 'worker', id, response);
  }

  @Get('people-data/users/:id/export')
  @ApiOperation({ summary: 'Everything held about one team member, as a ZIP' })
  async exportUser(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.people.exportPerson(user, 'user', id, response);
  }

  @Post('people-data/workers/:id/anonymise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anonymise a former worker, keeping their wage records' })
  anonymiseWorker(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(dataExportAnonymiseSchema)) _body: DataExportAnonymiseInput,
  ) {
    return this.people.anonymise(user, 'worker', id);
  }

  @Post('people-data/users/:id/anonymise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anonymise a former team member, keeping the records they made' })
  anonymiseUser(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(dataExportAnonymiseSchema)) _body: DataExportAnonymiseInput,
  ) {
    return this.people.anonymise(user, 'user', id);
  }

  // --- the data processing agreement -------------------------------------------------------------

  @Get('legal')
  @ApiOperation({ summary: 'The DPA version, and which the company accepted' })
  legalOverview(@CurrentUser() user: RequestUser) {
    return this.legal.overview(user);
  }

  @Post('legal/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept the current DPA version for the company' })
  acceptLegal(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(dataExportLegalAcceptSchema)) body: DataExportLegalAcceptInput,
  ) {
    return this.legal.accept(user, body);
  }
}
