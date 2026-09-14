import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlansService } from './plans.service';

/**
 * The catalogue, as a builder sees it.
 *
 * Behind a tenant session but no permission: what the product costs is not privileged, and a
 * supervisor opening the plan screen out of curiosity should not get a 403. Retired plans are not
 * listed — nobody is offered a term that is no longer sold.
 */
@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Plans on sale' })
  async list() {
    return { items: await this.plans.listActive() };
  }
}
