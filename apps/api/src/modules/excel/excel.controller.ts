import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  importCommitSchema,
  importFileSchema,
  importKindSchema,
  type ImportCommitInput,
  type ImportFileInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ExportsService } from './exports.service';
import { ImportService } from './import.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function download(response: Response, file: { fileName: string; contentType?: string; body: Buffer }): StreamableFile {
  response.set({
    'Content-Type': file.contentType ?? XLSX,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    // Exports carry wages, rates and people's phone numbers: nothing between here and the disk keeps a copy.
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.body);
}

/**
 * Excel on every table (roadmap Phase 3, item 4).
 *
 * No `@RequiresPermission` here on purpose: one route serves every table, so the services check the
 * permission and plan module of the table asked for — the same ones its own list or create endpoint
 * declares. Authentication, the company's IP allow-list, two-factor and a lapsed plan's read-only
 * mode still apply, through the global guards like on any route.
 */
@ApiTags('excel')
@Controller()
export class ExcelController {
  constructor(
    private readonly exports: ExportsService,
    private readonly imports: ImportService,
  ) {}

  @Get('exports/:kind')
  @ApiOperation({ summary: 'Any table as .xlsx (default) or CSV, with the same filters as its list' })
  async export(
    @CurrentUser() user: RequestUser,
    @Param('kind') kind: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!/^[a-z_]{1,40}$/.test(kind)) throw ApiError.notFound('Export');
    return download(response, await this.exports.export(user, kind, query));
  }

  @Get('imports/:kind/template')
  @ApiOperation({ summary: 'An .xlsx template for an import: headers, an example row, dropdowns and instructions' })
  async template(
    @CurrentUser() user: RequestUser,
    @Param('kind') kind: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const parsed = importKindSchema.safeParse(kind);
    if (!parsed.success) throw ApiError.notFound('Import');
    return download(response, await this.imports.template(user, parsed.data));
  }

  @Post('imports/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read an .xlsx or .csv and show what importing it would do, row by row' })
  preview(@CurrentUser() user: RequestUser, @Body(zodBody(importFileSchema)) body: ImportFileInput) {
    return this.imports.preview(user, body);
  }

  @Post('imports')
  @ApiOperation({ summary: 'Import: every row or nothing, or the valid rows only' })
  commit(@CurrentUser() user: RequestUser, @Body(zodBody(importCommitSchema)) body: ImportCommitInput) {
    return this.imports.commit(user, body);
  }

  @Post('imports/error-report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The rows with problems as .xlsx, with what is wrong with each' })
  async errorReport(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(importFileSchema)) body: ImportFileInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return download(response, await this.imports.errorReport(user, body));
  }
}
