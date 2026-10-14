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
import {
  campDayQuerySchema,
  campResidentsSchema,
  createCampSchema,
  updateCampSchema,
  type CampResidentsInput,
  type CreateCampInput,
  type UpdateCampInput,
} from '@sitebook/shared';
import type { z } from 'zod';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CampsService } from './camps.service';

/** Labour camps: who lives where, and how many went from each to each site today. */
@ApiTags('camps')
@RequiresModule('labour')
@Controller('camps')
export class CampsController {
  constructor(private readonly camps: CampsService) {}

  @RequiresPermission('workers.view')
  @Get()
  @ApiOperation({ summary: 'Camps with residents and the day’s headcount by site' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(campDayQuerySchema)) query: z.infer<typeof campDayQuerySchema>,
  ) {
    return this.camps.list(user, query.date);
  }

  @RequiresPermission('workers.manage')
  @Post()
  @ApiOperation({ summary: 'Add a camp' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(createCampSchema)) body: CreateCampInput) {
    return this.camps.create(user, body);
  }

  @RequiresPermission('workers.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Edit a camp or its transport note' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateCampSchema)) body: UpdateCampInput,
  ) {
    return this.camps.update(user, id, body);
  }

  @RequiresPermission('workers.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a camp; its residents become unassigned' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.camps.remove(user, id);
  }

  @RequiresPermission('workers.view')
  @Get(':id/residents')
  @ApiOperation({ summary: 'Who lives in a camp' })
  residents(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.camps.residents(user, id);
  }

  @RequiresPermission('workers.manage')
  @Post(':id/residents')
  @ApiOperation({ summary: 'Move workers into a camp' })
  addResidents(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(campResidentsSchema)) body: CampResidentsInput,
  ) {
    return this.camps.addResidents(user, id, body);
  }

  @RequiresPermission('workers.manage')
  @Delete(':id/residents/:workerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take a worker out of a camp' })
  async removeResident(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('workerId', ParseUUIDPipe) workerId: string,
  ) {
    await this.camps.removeResident(user, id, workerId);
  }
}
