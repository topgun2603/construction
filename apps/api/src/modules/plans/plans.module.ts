import { Global, Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

/**
 * Global because three unrelated places need the catalogue: the tenant API that lists it, the
 * platform console that edits it, and tenant creation — which has to ask how long a term runs
 * before it can say when one ends.
 */
@Global()
@Module({
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
