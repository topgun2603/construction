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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWorkerDocumentSchema,
  updateWorkerDocumentSchema,
  type CreateWorkerDocumentInput,
  type UpdateWorkerDocumentInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { WorkerDocumentsService } from './worker-documents.service';

/**
 * Workers' papers. Seeing that a worker has an Emirates ID ending 5671 that lapses on the 12th
 * needs `workers.view`; adding one, or reading the whole number, needs `workers.manage`.
 */
@ApiTags('worker-documents')
@RequiresModule('labour')
@Controller()
export class WorkerDocumentsController {
  constructor(private readonly documents: WorkerDocumentsService) {}

  @RequiresPermission('workers.view')
  @Get('workers/:id/documents')
  @ApiOperation({ summary: 'A worker’s papers, numbers masked' })
  list(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.list(user, id);
  }

  @RequiresPermission('workers.manage')
  @Post('workers/:id/documents')
  @ApiOperation({ summary: 'Record a passport, visa, Emirates ID, Iqama or labour card' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createWorkerDocumentSchema)) body: CreateWorkerDocumentInput,
  ) {
    return this.documents.create(user, id, body);
  }

  @RequiresPermission('workers.view')
  @Get('worker-documents/expiring')
  @ApiOperation({ summary: 'Papers lapsing within 30 days or already lapsed' })
  expiring(@CurrentUser() user: RequestUser) {
    return this.documents.expiring(user);
  }

  @RequiresPermission('workers.manage')
  @Patch('worker-documents/:id')
  @ApiOperation({ summary: 'Renew or correct a document' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateWorkerDocumentSchema)) body: UpdateWorkerDocumentInput,
  ) {
    return this.documents.update(user, id, body);
  }

  @RequiresPermission('workers.manage')
  @Delete('worker-documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a document' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.documents.remove(user, id);
  }

  @RequiresPermission('workers.manage')
  @Post('worker-documents/:id/reveal')
  @ApiOperation({ summary: 'The full number; the look is audited' })
  reveal(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.reveal(user, id);
  }

  @RequiresPermission('workers.view')
  @Get('worker-documents/:id/scan')
  @ApiOperation({ summary: 'A short-lived link to the scan' })
  scan(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.scanUrl(user, id);
  }
}
