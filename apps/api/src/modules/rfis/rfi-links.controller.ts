import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  rfiExternalAnswerSchema,
  rfiExternalPresignSchema,
  rfiLinkTokenSchema,
  submittalExternalReviewSchema,
  type RfiExternalAnswerInput,
  type RfiExternalPresignInput,
  type SubmittalExternalReviewInput,
} from '@sitebook/shared';
import { Public } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { RfiLinksService } from './rfi-links.service';

/**
 * The designer's or consultant's page, opened from a link (roadmap Phase 2, module 9).
 *
 * `@Public()` because the reader has no account. Authentication is the signature on the token,
 * which names one record in one company and expires — the same model as the worker's link. Rate
 * limited because the URL is the credential.
 */
@ApiTags('rfi links')
@Public()
@Controller('rfi-links')
export class RfiLinksController {
  constructor(private readonly links: RfiLinksService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('view')
  @ApiOperation({ summary: 'The one RFI or submittal revision a signed link names' })
  view(@Query(zodBody(rfiLinkTokenSchema)) query: { token: string }) {
    return this.links.view(query.token);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'An upload URL for one file, under this record only' })
  presign(@Body(zodBody(rfiExternalPresignSchema)) body: RfiExternalPresignInput) {
    return this.links.presign(body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Answer the RFI the link names' })
  answer(@Body(zodBody(rfiExternalAnswerSchema)) body: RfiExternalAnswerInput) {
    return this.links.answer(body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a review on the submittal revision the link names' })
  review(@Body(zodBody(submittalExternalReviewSchema)) body: SubmittalExternalReviewInput) {
    return this.links.review(body);
  }
}
