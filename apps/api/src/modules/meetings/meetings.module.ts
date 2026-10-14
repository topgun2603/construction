import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

/**
 * Site meetings with minutes and action items (roadmap Phase 3, "Calendar and email"). Invites and
 * minutes go out through the Microsoft 365 module, which is global.
 */
@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
