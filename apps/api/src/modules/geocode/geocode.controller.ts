import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { GeocodeService } from './geocode.service';

const searchSchema = z.object({ q: z.string().trim().min(3).max(160) });

/**
 * Turning a place name into coordinates, for the site location picker.
 *
 * Rate limited well below the throttler's default. Every call here becomes a call to a free public
 * service that asks for at most one request a second, and a search box fires on every keystroke — the
 * client debounces, and this is the backstop for when it does not.
 */
@ApiTags('geocode')
@Controller('geocode')
export class GeocodeController {
  constructor(private readonly geocode: GeocodeService) {}

  @RequiresPermission('projects.manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get()
  @ApiOperation({ summary: 'Search for a place by name' })
  async search(@Query(zodBody(searchSchema)) query: { q: string }) {
    return { results: await this.geocode.search(query.q) };
  }
}
