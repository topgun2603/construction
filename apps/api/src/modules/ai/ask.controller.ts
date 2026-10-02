import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { askSchema, type AskInput } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AskService } from './ask.service';

@ApiTags('ask')
@Controller('ask')
export class AskController {
  constructor(private readonly ask: AskService) {}

  /**
   * No permission beyond being signed in: every figure is computed under the caller's own project
   * scope, so a supervisor asking about spend gets the spend on the sites they are on and a client
   * gets nothing they could not already open.
   *
   * Throttled because each call costs money at a vendor. Sixty an hour is more questions than
   * anybody asks in a day and far fewer than a script would.
   */
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Answer a question about this account’s own numbers' })
  answer(@CurrentUser() user: RequestUser, @Body(zodBody(askSchema)) body: AskInput) {
    return this.ask.ask(user, body.question);
  }
}
