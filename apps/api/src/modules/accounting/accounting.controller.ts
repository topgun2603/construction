import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ACCOUNTING_SYSTEMS,
  accountingDefaultsSchema,
  accountingExportSchema,
  accountingMappingSchema,
  accountingSettingsSchema,
  type AccountingDefaultsInput,
  type AccountingExportInput,
  type AccountingMappingInput,
  type AccountingSettingsInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AccountingExportService } from './accounting-export.service';
import { AccountingSettingsService } from './accounting-settings.service';

const overviewQuerySchema = z.object({ system: z.enum(ACCOUNTING_SYSTEMS).optional() });

/**
 * Accounting exports (roadmap Phase 3). Settings → Accounting reads with either permission and
 * writes with `accounting.manage`; Reports → Export to accounts is `accounting.export`.
 */
@ApiTags('accounting')
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly settings: AccountingSettingsService,
    private readonly exports: AccountingExportService,
  ) {}

  @RequiresPermission('accounting.manage', 'accounting.export')
  @Get('settings')
  @ApiOperation({ summary: 'The accounting system, and the account mapping for one system with suggestions' })
  overview(@CurrentUser() user: RequestUser, @Query(zodBody(overviewQuerySchema)) query: { system?: (typeof ACCOUNTING_SYSTEMS)[number] }) {
    return this.settings.overview(user, query.system);
  }

  @RequiresPermission('accounting.manage')
  @Put('settings')
  @ApiOperation({ summary: 'Choose the accounting system and its file details' })
  saveSettings(@CurrentUser() user: RequestUser, @Body(zodBody(accountingSettingsSchema)) body: AccountingSettingsInput) {
    return this.settings.saveSettings(user, body);
  }

  @RequiresPermission('accounting.manage')
  @Put('mappings')
  @ApiOperation({ summary: 'Save account mapping rows; an empty name clears one' })
  saveMappings(@CurrentUser() user: RequestUser, @Body(zodBody(accountingMappingSchema)) body: AccountingMappingInput) {
    return this.settings.saveMappings(user, body);
  }

  @RequiresPermission('accounting.manage')
  @Post('mappings/defaults')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fill every unmapped account with the suggested one' })
  applyDefaults(@CurrentUser() user: RequestUser, @Body(zodBody(accountingDefaultsSchema)) body: AccountingDefaultsInput) {
    return this.settings.applyDefaults(user, body);
  }

  @RequiresPermission('accounting.export')
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'What an export would carry: vouchers, totals by account, and any unmapped account' })
  preview(@CurrentUser() user: RequestUser, @Body(zodBody(accountingExportSchema)) body: AccountingExportInput) {
    return this.exports.preview(user, body);
  }

  @RequiresPermission('accounting.export')
  @Post('exports')
  @ApiOperation({ summary: 'Export a period to the accounting system: records a batch and its files' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(accountingExportSchema)) body: AccountingExportInput) {
    return this.exports.create(user, body);
  }

  @RequiresPermission('accounting.export')
  @Get('exports')
  @ApiOperation({ summary: 'Earlier exports, newest first' })
  list(@CurrentUser() user: RequestUser) {
    return this.exports.list(user);
  }

  @RequiresPermission('accounting.export')
  @Get('exports/:id')
  @ApiOperation({ summary: 'One export and its files' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exports.get(user, id);
  }

  @RequiresPermission('accounting.export')
  @Get('exports/:id/files/:fileId')
  @ApiOperation({ summary: 'Download a file of an export, exactly as it was written' })
  async file(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.exports.file(user, id, fileId);
    response.set({
      'Content-Type': `${file.contentType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(Buffer.from(file.content, 'utf8'));
  }
}
