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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createDprSchema,
  listDprQuerySchema,
  transcribeDprSchema,
  updateDprSchema,
  type CreateDprInput,
  type ListDprQuery,
  type TranscribeDprInput,
  type UpdateDprInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { DprService } from './dpr.service';

@ApiTags('dpr')
@RequiresModule('dpr')
@Controller('dpr')
export class DprController {
  constructor(private readonly dpr: DprService) {}

  @RequiresPermission('dpr.view')
  @Get()
  @ApiOperation({ summary: 'List daily progress reports' })
  list(@CurrentUser() user: RequestUser, @Query(zodBody(listDprQuerySchema)) query: ListDprQuery) {
    return this.dpr.list(user, query);
  }

  @RequiresPermission('dpr.file')
  @Post()
  @ApiOperation({ summary: 'File a daily progress report' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(createDprSchema)) body: CreateDprInput) {
    return this.dpr.create(user, body);
  }

  /**
   * Reads an uploaded voice note into a report draft. Saves nothing.
   *
   * `dpr.file` rather than `dpr.view`: this is the first half of filing one, and it spends money at
   * a vendor per call. It sits above `:id` so "voice" is never read as a report id.
   *
   * Rate limited harder than the rest of this controller for the same reason the bill scan is.
   * Forty an hour is more notes than a supervisor records in a week of long days, and far fewer
   * than a loop would send.
   */
  @Throttle({ default: { limit: 40, ttl: 3_600_000 } })
  @RequiresPermission('dpr.file')
  @Post('voice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a spoken site note into a report draft' })
  voice(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(transcribeDprSchema)) body: TranscribeDprInput,
  ) {
    return this.dpr.transcribeNote(user, body);
  }

  @RequiresPermission('dpr.view')
  @Get(':id')
  @ApiOperation({ summary: 'Read one report' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dpr.get(user, id);
  }

  @RequiresPermission('dpr.file')
  @Patch(':id')
  @ApiOperation({ summary: 'Edit a draft report' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateDprSchema)) body: UpdateDprInput,
  ) {
    return this.dpr.update(user, id, body);
  }

  @RequiresPermission('dpr.file')
  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit a report' })
  submit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dpr.submit(user, id);
  }

  @RequiresPermission('dpr.file')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard a draft report' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.dpr.archive(user, id);
  }

}
