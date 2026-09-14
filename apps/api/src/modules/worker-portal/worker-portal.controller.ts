import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { WorkerPortalService } from './worker-portal.service';

const tokenSchema = z.object({ token: z.string().min(20).max(2000) });

/**
 * A worker's own attendance and dues, opened from a link (spec §3 item 15).
 *
 * `@Public()` because the reader has no account and never will. Authentication is the signature on
 * the token itself, which names one worker and expires — there is no session here to steal and no
 * parameter to tamper with.
 *
 * Rate limited because the URL is the credential, and a credential in a URL is one somebody will
 * eventually try to guess. Forging a signature is not feasible; hammering the endpoint to find out
 * whether a token is still live should still be slow.
 */
@ApiTags('worker portal')
@Public()
@Controller('worker-portal')
export class WorkerPortalController {
  constructor(private readonly portal: WorkerPortalService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('summary')
  @ApiOperation({ summary: "One worker's attendance and payments, from a signed link" })
  summary(@Query(zodBody(tokenSchema)) query: { token: string }) {
    return this.portal.summary(query.token);
  }
}
