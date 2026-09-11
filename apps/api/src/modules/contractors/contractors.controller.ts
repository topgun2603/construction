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
  createContractorSchema,
  cursorPaginationSchema,
  updateContractorSchema,
  type CreateContractorInput,
  type CursorPagination,
  type UpdateContractorInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ContractorsService } from './contractors.service';

@ApiTags('contractors')
@RequiresModule('labour')
@Controller('contractors')
export class ContractorsController {
  constructor(private readonly contractors: ContractorsService) {}

  @RequiresPermission('contractors.manage', 'workers.view')
  @Get()
  @ApiOperation({ summary: 'List contractors' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(cursorPaginationSchema)) query: CursorPagination,
  ) {
    return this.contractors.list(user, query);
  }

  @RequiresPermission('contractors.manage')
  @Post()
  @ApiOperation({ summary: 'Add a contractor' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createContractorSchema)) body: CreateContractorInput,
  ) {
    return this.contractors.create(user, body);
  }

  @RequiresPermission('contractors.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a contractor' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateContractorSchema)) body: UpdateContractorInput,
  ) {
    return this.contractors.update(user, id, body);
  }

  @RequiresPermission('contractors.delete')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a contractor' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.contractors.archive(user, id);
  }
}
