import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attendanceRegisterQuerySchema,
  labourCostQuerySchema,
  personLedgerQuerySchema,
  taxReportQuerySchema,
  type AttendanceRegisterQuery,
  type LabourCostQuery,
  type PersonLedgerQuery,
  type TaxReportQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';
import { TaxReportService } from './tax-report.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly taxReport: TaxReportService,
  ) {}

  /**
   * VAT or GST paid on expenses and charged on instalments (roadmap Phase 1, item 5). The same gate
   * as expenses: it is a statement of what the company spent and billed.
   */
  @RequiresModule('expenses')
  @RequiresPermission('expenses.view')
  @Get('tax')
  @ApiOperation({ summary: 'Input and output tax over a range, by month' })
  tax(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(taxReportQuerySchema)) query: TaxReportQuery,
  ) {
    return this.taxReport.report(user, query);
  }

  /**
   * Gated on `labour` rather than `reports`: knowing this week's labour cost is
   * core to the Starter plan (spec §3 item 8), while the Reports *module* is the
   * Phase 2 analytics suite.
   */
  @RequiresModule('labour')
  @RequiresPermission('reports.view')
  @Get('labour-cost')
  @ApiOperation({ summary: 'Labour cost by project, contractor or worker' })
  labourCost(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(labourCostQuerySchema)) query: LabourCostQuery,
  ) {
    return this.reports.labourCost(user, query);
  }

  @RequiresModule('labour')
  @RequiresPermission('wages.view')
  @Get('wage-sheet/:wagePeriodId')
  @ApiOperation({ summary: 'Printable wage sheet for a period' })
  wageSheet(
    @CurrentUser() user: RequestUser,
    @Param('wagePeriodId', ParseUUIDPipe) wagePeriodId: string,
  ) {
    return this.reports.wageSheet(user, wagePeriodId);
  }

  /**
   * The muster roll. Gated on `attendance`, the module that produces it, and open to
   * project managers because it is the sheet they check a contractor's claim against.
   */
  @RequiresModule('attendance')
  @RequiresPermission('reports.view')
  @Get('attendance-register')
  @ApiOperation({ summary: 'Attendance register for a period, day by day' })
  attendanceRegister(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(attendanceRegisterQuerySchema)) query: AttendanceRegisterQuery,
  ) {
    return this.reports.attendanceRegister(user, query);
  }

  /**
   * Owner and accounts only. This reads as a judgement on individuals, and a
   * supervisor seeing their own numbers ranked against their colleagues' is a
   * different product decision than the one this report is for.
   */
  @RequiresModule('labour')
  @RequiresPermission('reports.people')
  @Get('person-ledger')
  @ApiOperation({ summary: 'What each person committed on the company behalf' })
  personLedger(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(personLedgerQuerySchema)) query: PersonLedgerQuery,
  ) {
    return this.reports.personLedger(user, query);
  }
}
