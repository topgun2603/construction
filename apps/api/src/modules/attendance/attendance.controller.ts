import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attendanceQuerySchema,
  attendanceSummaryQuerySchema,
  bulkAttendanceSchema,
  type AttendanceQuery,
  type AttendanceSummaryQuery,
  type BulkAttendanceInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AttendanceService } from './attendance.service';

@ApiTags('attendance')
@RequiresModule('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @RequiresPermission('attendance.view')
  @Get()
  @ApiOperation({ summary: 'The roll call for one site on one date' })
  forDate(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(attendanceQuerySchema)) query: AttendanceQuery,
  ) {
    return this.attendance.forDate(user, query.project_id, query.date);
  }

  @RequiresPermission('attendance.record')
  @Post()
  @ApiOperation({ summary: 'Record a roll call (bulk upsert, one row per worker)' })
  record(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(bulkAttendanceSchema)) body: BulkAttendanceInput,
  ) {
    return this.attendance.record(user, body);
  }

  @RequiresPermission('attendance.view')
  @Get('summary')
  @ApiOperation({ summary: 'Days and cost by worker, contractor and project' })
  summary(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(attendanceSummaryQuerySchema)) query: AttendanceSummaryQuery,
  ) {
    return this.attendance.summary(user, query);
  }
}
