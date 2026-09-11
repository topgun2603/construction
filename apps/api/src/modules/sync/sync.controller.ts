import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  syncPullQuerySchema,
  syncPushSchema,
  type SyncPullQuery,
  type SyncPushInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SyncService } from './sync.service';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * A phone coming back from days offline can legitimately push several large
   * batches in a row, so the limit here is generous compared with the default.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('push')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a device outbox batch' })
  push(@CurrentUser() user: RequestUser, @Body(zodBody(syncPushSchema)) body: SyncPushInput) {
    return this.sync.push(user, body);
  }

  @Get('pull')
  @ApiOperation({ summary: 'Rows changed since a cursor, for this user’s sites' })
  pull(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(syncPullQuerySchema)) query: SyncPullQuery,
  ) {
    return this.sync.pull(user, query);
  }
}
