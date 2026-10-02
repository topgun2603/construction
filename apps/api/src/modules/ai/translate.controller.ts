import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { translateSchema, type TranslateInput } from '@sitebook/shared';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { RequestUser } from '../../common/auth/request-user';
import { TranslateService } from './translate.service';

@ApiTags('translate')
@Controller('translate')
export class TranslateController {
  constructor(private readonly translate: TranslateService) {}

  /**
   * No permission beyond being signed in. Nothing of the account's is read: the text comes from the
   * request and the answer goes straight back, so there is nothing here to be scoped to.
   *
   * The throttle is the real control, and it is set for how this is used. This fires while somebody
   * types — debounced, but a long note still produces several calls as they pause between
   * sentences. Four hundred an hour is a full afternoon of writing in two languages and well under
   * what a loop would manage. Identical text inside the window is served from the service's own
   * cache and never reaches a vendor.
   */
  @Throttle({ default: { limit: 400, ttl: 3_600_000 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Translate a line of text into another language' })
  run(
    @CurrentUser() _user: RequestUser,
    @Body(zodBody(translateSchema)) body: TranslateInput,
  ) {
    return this.translate.translate(body);
  }
}
