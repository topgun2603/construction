import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  presignSchema,
  viewObjectSchema,
  type PresignInput,
  type ViewObjectInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Rate limited: a presigned URL is a write capability, and a phone syncing a
   * day's photos should burst, not hammer.
   */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a short-lived URL to upload one file' })
  presign(@CurrentUser() user: RequestUser, @Body(zodBody(presignSchema)) body: PresignInput) {
    return this.uploads.presign(user, body);
  }

  /**
   * A short-lived URL to view an object the caller's tenant owns.
   *
   * A POST rather than a GET so the key travels in a body: keys end up in browser history, proxy logs
   * and referrer headers when they sit in a query string, and this one is the only thing between a
   * request and somebody's site photographs.
   */
  @Post('view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Short-lived URL to read one object' })
  view(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(viewObjectSchema)) body: ViewObjectInput,
  ) {
    return this.uploads.viewUrl(user, body);
  }

}
