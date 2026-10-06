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
  meetingActionItemSchema,
  meetingActionItemUpdateSchema,
  meetingCreateSchema,
  meetingListQuerySchema,
  meetingSendMinutesSchema,
  meetingUpdateSchema,
  type MeetingActionItemInput,
  type MeetingActionItemUpdateInput,
  type MeetingCreateInput,
  type MeetingListQuery,
  type MeetingSendMinutesInput,
  type MeetingUpdateInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { MeetingsService } from './meetings.service';

/**
 * Site meetings. Behind `projects`, like RFIs and safety: every meeting belongs to a site, and a new
 * module name would be missing from every account whose module list was stored before it existed.
 */
@ApiTags('meetings')
@RequiresModule('projects')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @RequiresPermission('meetings.view')
  @Get()
  @ApiOperation({ summary: 'Meetings on the sites the caller can see, newest first' })
  list(@CurrentUser() user: RequestUser, @Query(zodBody(meetingListQuerySchema)) query: MeetingListQuery) {
    return this.meetings.list(user, query);
  }

  @RequiresPermission('meetings.view')
  @Get(':id')
  @ApiOperation({ summary: 'One meeting: attendees, agenda, minutes, action items and emails sent' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.get(user, id);
  }

  @RequiresPermission('meetings.manage')
  @Post()
  @ApiOperation({ summary: 'Book a meeting on a site' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(meetingCreateSchema)) body: MeetingCreateInput) {
    return this.meetings.create(user, body);
  }

  @RequiresPermission('meetings.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Change the meeting, its attendees, or write the minutes' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(meetingUpdateSchema)) body: MeetingUpdateInput,
  ) {
    return this.meetings.update(user, id, body);
  }

  @RequiresPermission('meetings.manage')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the meeting (and the Outlook invite, if one went out)' })
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.cancel(user, id);
  }

  @RequiresPermission('meetings.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a meeting nobody was sent anything about' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.remove(user, id);
  }

  @RequiresPermission('meetings.manage')
  @Post(':id/action-items')
  @ApiOperation({ summary: 'Add an action item' })
  addAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(meetingActionItemSchema)) body: MeetingActionItemInput,
  ) {
    return this.meetings.addAction(user, id, body);
  }

  @RequiresPermission('meetings.manage')
  @Patch(':id/action-items/:itemId')
  @ApiOperation({ summary: 'Change an action item, or mark it done' })
  updateAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(zodBody(meetingActionItemUpdateSchema)) body: MeetingActionItemUpdateInput,
  ) {
    return this.meetings.updateAction(user, id, itemId, body);
  }

  @RequiresPermission('meetings.manage')
  @Delete(':id/action-items/:itemId')
  @ApiOperation({ summary: 'Remove an action item' })
  removeAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.meetings.removeAction(user, id, itemId);
  }

  @RequiresPermission('meetings.manage')
  @Post(':id/invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send (or update) the Outlook invite from the connected Microsoft 365 calendar' })
  invite(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.sendInvite(user, id);
  }

  @RequiresPermission('meetings.manage')
  @Post(':id/minutes/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email the minutes and action items to the attendees' })
  sendMinutes(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(meetingSendMinutesSchema)) body: MeetingSendMinutesInput,
  ) {
    return this.meetings.sendMinutes(user, id, body);
  }
}
