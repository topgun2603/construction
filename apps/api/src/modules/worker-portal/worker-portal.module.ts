import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkerPortalController } from './worker-portal.controller';
import { WorkerPortalService } from './worker-portal.service';

/**
 * The worker-facing read of their own record.
 *
 * Its own module rather than a route on `workers`: everything in that controller is behind a
 * tenant session and a permission, and a public route living among them is the kind of thing that
 * gets a guard added to it by accident, or worse, loses one.
 */
@Module({
  imports: [AuthModule],
  controllers: [WorkerPortalController],
  providers: [WorkerPortalService],
})
export class WorkerPortalModule {}
