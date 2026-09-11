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
  createDocumentSchema,
  listDocumentsQuerySchema,
  listMessagesQuerySchema,
  markMessagesReadSchema,
  postMessageSchema,
  updateDocumentSchema,
  type CreateDocumentInput,
  type ListDocumentsQuery,
  type ListMessagesQuery,
  type MarkMessagesReadInput,
  type PostMessageInput,
  type UpdateDocumentInput,
} from '@sitebook/shared';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { RequestUser } from '../../common/auth/request-user';
import { DocumentsService } from './documents.service';
import { MessagesService } from './messages.service';

/**
 * The site conversation.
 *
 * Reading needs only `projects.view` — a client can see the thread on their own building, and being
 * able to see the site is the same question as being able to see what was said about it. Writing
 * needs `messages.post`, which the client has and a role could be denied.
 */
@ApiTags('portal')
@RequiresModule('client_portal')
@Controller('projects/:id/messages')
export class SiteMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @RequiresPermission('projects.view')
  @Get()
  @ApiOperation({ summary: 'The conversation on this site' })
  list(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodBody(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messages.list(user, id, query);
  }

  /**
   * Who can be written to here.
   *
   * Needs only `projects.view`, the same as reading: a client picking the site engineer out of a
   * list is the feature working, and the list is already everybody they can see on their own job.
   */
  @RequiresPermission('projects.view')
  @Get('recipients')
  @ApiOperation({ summary: 'People who can be messaged directly on this site' })
  recipients(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messages.recipients(user, id);
  }

  @RequiresPermission('messages.post')
  @Post()
  @ApiOperation({ summary: 'Say something on this site' })
  post(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(postMessageSchema)) body: PostMessageInput,
  ) {
    return this.messages.post(user, id, body);
  }

  /**
   * Read up to here.
   *
   * `projects.view`, not `messages.post`: somebody who may read the thread but not write in it
   * still reads it, and their having done so is what the other side is waiting to know.
   */
  @RequiresPermission('projects.view')
  @Post('read')
  @ApiOperation({ summary: 'Mark this conversation read' })
  markRead(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(markMessagesReadSchema)) body: MarkMessagesReadInput,
  ) {
    return this.messages.markRead(user, id, body);
  }
}

@ApiTags('portal')
@RequiresModule('client_portal')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @RequiresPermission('messages.post')
  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take back something you said' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    await this.messages.remove(user, messageId);
  }
}

/**
 * Drawings, contracts and approvals.
 *
 * Reading needs `documents.view`, which the client has — but what they get back is filtered to what
 * somebody deliberately shared, in the service rather than here.
 */
@ApiTags('documents')
@RequiresModule('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequiresPermission('documents.view')
  @Get()
  @ApiOperation({ summary: 'Documents, newest revision of each' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listDocumentsQuerySchema)) query: ListDocumentsQuery,
  ) {
    return this.documents.list(user, query);
  }

  @RequiresPermission('documents.view')
  @Get(':familyId/history')
  @ApiOperation({ summary: 'Every revision of one document' })
  history(
    @CurrentUser() user: RequestUser,
    @Param('familyId', ParseUUIDPipe) familyId: string,
  ) {
    return this.documents.history(user, familyId);
  }

  @RequiresPermission('documents.manage')
  @Post()
  @ApiOperation({ summary: 'Record an uploaded document, or a new revision of one' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createDocumentSchema)) body: CreateDocumentInput,
  ) {
    return this.documents.create(user, body);
  }

  @RequiresPermission('documents.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Rename, recategorise, or share with the client' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateDocumentSchema)) body: UpdateDocumentInput,
  ) {
    return this.documents.update(user, id, body);
  }

  @RequiresPermission('documents.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one revision' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.documents.remove(user, id);
  }
}
