import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

const listQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Notifications for the current user' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.notifications.list(user.tenantId, user.userId, query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.tenantId, user.userId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Clear the unread badge' })
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notifications.markAllRead(user.tenantId, user.userId);
  }
}
