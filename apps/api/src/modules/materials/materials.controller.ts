import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createMaterialSchema,
  listMaterialsQuerySchema,
  type CreateMaterialInput,
  type ListMaterialsQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { MaterialsService } from './materials.service';

@ApiTags('materials')
@RequiresModule('materials')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @RequiresPermission('materials.manage', 'indents.raise')
  @Get()
  @ApiOperation({ summary: 'List the material catalogue' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listMaterialsQuerySchema)) query: ListMaterialsQuery,
  ) {
    return this.materials.list(user, query);
  }

  /** Any role that can raise an indent can add a material to the catalogue. */
  @RequiresPermission('materials.manage')
  @Post()
  @ApiOperation({ summary: 'Add a material' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createMaterialSchema)) body: CreateMaterialInput,
  ) {
    return this.materials.create(user, body);
  }

  @RequiresPermission('materials.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a material' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.materials.archive(user, id);
  }
}
