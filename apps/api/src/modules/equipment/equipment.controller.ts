import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addDays,
  allocateEquipmentSchema,
  bookEquipmentHireSchema,
  createEquipmentDocumentSchema,
  createEquipmentFuelSchema,
  createEquipmentLogSchema,
  createEquipmentMaintenanceSchema,
  createEquipmentSchema,
  createEquipmentServicePlanSchema,
  equipmentExportQuerySchema,
  equipmentHireStatementQuerySchema,
  equipmentReportQuerySchema,
  equipmentScanSchema,
  listEquipmentLogsQuerySchema,
  listEquipmentQuerySchema,
  releaseEquipmentSchema,
  todayIn,
  updateEquipmentAllocationSchema,
  updateEquipmentDocumentSchema,
  updateEquipmentLogSchema,
  updateEquipmentSchema,
  updateEquipmentServicePlanSchema,
  utcDateToIsoDate,
  type AllocateEquipmentInput,
  type BookEquipmentHireInput,
  type CreateEquipmentDocumentInput,
  type CreateEquipmentFuelInput,
  type CreateEquipmentInput,
  type CreateEquipmentLogInput,
  type CreateEquipmentMaintenanceInput,
  type CreateEquipmentServicePlanInput,
  type EquipmentExportQuery,
  type EquipmentMeterType,
  type EquipmentHireStatementQuery,
  type EquipmentReportQuery,
  type EquipmentScanInput,
  type ListEquipmentLogsQuery,
  type ListEquipmentQuery,
  type ReleaseEquipmentInput,
  type UpdateEquipmentAllocationInput,
  type UpdateEquipmentDocumentInput,
  type UpdateEquipmentInput,
  type UpdateEquipmentLogInput,
  type UpdateEquipmentServicePlanInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { isoDay, oneDecimalText, tenthsOf } from './equipment-common';
import { EquipmentCostsService } from './equipment-costs.service';
import { EquipmentLogsService } from './equipment-logs.service';
import { EquipmentMaintenanceService } from './equipment-maintenance.service';
import { EquipmentService, planView } from './equipment.service';

/**
 * Equipment and plant, roadmap Phase 2, module 10.
 *
 * Behind `projects`, like the other Phase 2 modules: a machine's cost lands on a site, and a new
 * module name would be missing from every account whose module list was stored before it.
 *
 * Three permissions: `equipment.view` sees rates and cost, `equipment.log` records the day's hours
 * and fuel from site, `equipment.manage` runs the register. Routes that only read the register admit
 * any of the three; money is stripped in the services for anybody without `equipment.view`.
 */
@ApiTags('equipment')
@RequiresModule('projects')
@Controller('equipment')
export class EquipmentController {
  constructor(
    private readonly equipment: EquipmentService,
    private readonly logs: EquipmentLogsService,
    private readonly maintenance: EquipmentMaintenanceService,
    private readonly costs: EquipmentCostsService,
    private readonly tenantDb: TenantDb,
  ) {}

  // --- register -----------------------------------------------------------------------------------

  @RequiresPermission('equipment.view', 'equipment.log', 'equipment.manage')
  @Get()
  @ApiOperation({ summary: 'The register: owned and hired machines, where each is, service and document state' })
  list(@CurrentUser() user: RequestUser, @Query(zodBody(listEquipmentQuerySchema)) query: ListEquipmentQuery) {
    return this.equipment.list(user, query);
  }

  @RequiresPermission('equipment.view', 'equipment.log', 'equipment.manage')
  @Get('board')
  @ApiOperation({ summary: 'Machines on each site today, and whether they have been logged' })
  board(@CurrentUser() user: RequestUser) {
    return this.equipment.board(user);
  }

  @RequiresPermission('equipment.manage')
  @Post()
  @ApiOperation({ summary: 'Register a machine, owned or hired' })
  create(@CurrentUser() user: RequestUser, @Body(zodBody(createEquipmentSchema)) body: CreateEquipmentInput) {
    return this.equipment.create(user, body);
  }

  // --- daily logs ---------------------------------------------------------------------------------

  @RequiresPermission('equipment.view', 'equipment.log', 'equipment.manage')
  @Get('logs')
  @ApiOperation({ summary: 'Daily logs, newest first' })
  listLogs(@CurrentUser() user: RequestUser, @Query(zodBody(listEquipmentLogsQuerySchema)) query: ListEquipmentLogsQuery) {
    return this.logs.list(user, query);
  }

  @RequiresPermission('equipment.log', 'equipment.manage')
  @Post('logs')
  @ApiOperation({ summary: 'Log a machine’s day: meter, hours, operator, and any fuel issued' })
  createLog(@CurrentUser() user: RequestUser, @Body(zodBody(createEquipmentLogSchema)) body: CreateEquipmentLogInput) {
    return this.logs.create(user, body);
  }

  @RequiresPermission('equipment.log', 'equipment.manage')
  @Patch('logs/:id')
  @ApiOperation({ summary: 'Correct a log — your own, or anybody’s as a manager' })
  updateLog(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateEquipmentLogSchema)) body: UpdateEquipmentLogInput,
  ) {
    return this.logs.update(user, id, body);
  }

  @RequiresPermission('equipment.manage')
  @Delete('logs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a log' })
  async removeLog(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.logs.remove(user, id);
  }

  // --- fuel ---------------------------------------------------------------------------------------

  @RequiresPermission('equipment.view', 'equipment.log', 'equipment.manage')
  @Get('fuel')
  @ApiOperation({ summary: 'Fuel issued, newest first' })
  listFuel(@CurrentUser() user: RequestUser, @Query(zodBody(listEquipmentLogsQuerySchema)) query: ListEquipmentLogsQuery) {
    return this.logs.listFuel(user, query);
  }

  @RequiresPermission('equipment.log', 'equipment.manage')
  @Post('fuel')
  @ApiOperation({ summary: 'Record fuel issued: bought for it, on an expense, from stock, or the vendor’s' })
  createFuel(@CurrentUser() user: RequestUser, @Body(zodBody(createEquipmentFuelSchema)) body: CreateEquipmentFuelInput) {
    return this.logs.createFuel(user, body);
  }

  @RequiresPermission('equipment.manage')
  @Delete('fuel/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a fuel entry; stock fuel goes back into stock' })
  async removeFuel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.logs.removeFuel(user, id);
  }

  // --- photos -------------------------------------------------------------------------------------

  @RequiresPermission('equipment.log', 'equipment.manage')
  @Post('scan/meter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a meter photo into a reading to confirm. Saves nothing.' })
  scanMeter(@CurrentUser() user: RequestUser, @Body(zodBody(equipmentScanSchema)) body: EquipmentScanInput) {
    return this.logs.scanMeter(user, body);
  }

  @RequiresPermission('equipment.log', 'equipment.manage')
  @Post('scan/fuel-bill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a fuel bill photo into litres, amount and date to confirm. Saves nothing.' })
  scanFuelBill(@CurrentUser() user: RequestUser, @Body(zodBody(equipmentScanSchema)) body: EquipmentScanInput) {
    return this.logs.scanFuelBill(user, body);
  }

  // --- maintenance --------------------------------------------------------------------------------

  @RequiresPermission('equipment.view', 'equipment.manage')
  @Get('maintenance')
  @ApiOperation({ summary: 'Services and repairs, newest first' })
  listMaintenance(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listEquipmentLogsQuerySchema)) query: ListEquipmentLogsQuery,
  ) {
    return this.maintenance.list(user, query);
  }

  @RequiresPermission('equipment.view', 'equipment.log', 'equipment.manage')
  @Get('maintenance/due')
  @ApiOperation({ summary: 'Services due or overdue and papers lapsing, across the fleet' })
  due(@CurrentUser() user: RequestUser) {
    return this.maintenance.due(user);
  }

  @RequiresPermission('equipment.manage')
  @Patch('service-plans/:id')
  @ApiOperation({ summary: 'Change a service plan' })
  updatePlan(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateEquipmentServicePlanSchema)) body: UpdateEquipmentServicePlanInput,
  ) {
    return this.equipment.updatePlan(user, id, body);
  }

  // --- reports ------------------------------------------------------------------------------------

  @RequiresPermission('equipment.view')
  @Get('reports/costs')
  @ApiOperation({ summary: 'Cost per machine and site, per site and per cost code, and what the cost report counts' })
  costReport(@CurrentUser() user: RequestUser, @Query(zodBody(equipmentReportQuerySchema)) query: EquipmentReportQuery) {
    return this.costs.costs(user, query);
  }

  @RequiresPermission('equipment.view')
  @Get('reports/utilisation')
  @ApiOperation({ summary: 'Worked against available hours, idle, breakdown and fuel per hour' })
  utilisation(@CurrentUser() user: RequestUser, @Query(zodBody(equipmentReportQuerySchema)) query: EquipmentReportQuery) {
    return this.costs.utilisation(user, query);
  }

  @RequiresPermission('equipment.view')
  @Get('reports/fuel')
  @ApiOperation({ summary: 'Fuel per machine, and days well above its own average' })
  fuelReport(@CurrentUser() user: RequestUser, @Query(zodBody(equipmentReportQuerySchema)) query: EquipmentReportQuery) {
    return this.costs.fuel(user, query);
  }

  @RequiresPermission('equipment.view')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="equipment.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The register, logs, fuel, maintenance, cost or utilisation as CSV' })
  exportCsv(@CurrentUser() user: RequestUser, @Query(zodBody(equipmentExportQuerySchema)) query: EquipmentExportQuery) {
    return this.costs.exportCsv(user, query);
  }

  @RequiresPermission('equipment.view')
  @Get('hire-statement')
  @ApiOperation({ summary: 'One vendor’s month: days, hours, minimums, hire, operator and mobilisation' })
  hireStatement(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(equipmentHireStatementQuerySchema)) query: EquipmentHireStatementQuery,
  ) {
    return this.costs.hireStatement(user, query);
  }

  @RequiresPermission('equipment.manage')
  @Post('hire-statement/book')
  @ApiOperation({ summary: 'Book a checked vendor invoice as expenses; the cost report then counts those instead' })
  bookHire(@CurrentUser() user: RequestUser, @Body(zodBody(bookEquipmentHireSchema)) body: BookEquipmentHireInput) {
    return this.costs.bookHire(user, body);
  }

  // --- allocations and documents (by their own id) ------------------------------------------------

  @RequiresPermission('equipment.manage')
  @Patch('allocations/:id')
  @ApiOperation({ summary: 'Correct the dates or cost code of a stay on a site' })
  updateAllocation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateEquipmentAllocationSchema)) body: UpdateEquipmentAllocationInput,
  ) {
    return this.equipment.updateAllocation(user, id, body);
  }

  @RequiresPermission('equipment.manage')
  @Patch('documents/:id')
  @ApiOperation({ summary: 'Renew or correct a document' })
  updateDocument(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateEquipmentDocumentSchema)) body: UpdateEquipmentDocumentInput,
  ) {
    return this.equipment.updateDocument(user, id, body);
  }

  @RequiresPermission('equipment.manage')
  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a document' })
  async removeDocument(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.equipment.removeDocument(user, id);
  }

  // --- one machine --------------------------------------------------------------------------------

  @RequiresPermission('equipment.view', 'equipment.log', 'equipment.manage')
  @Get(':id')
  @ApiOperation({ summary: 'One machine: where it has been, its logs, servicing, documents and cost' })
  async get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    const today = todayIn(user.timezone);
    const machine = await this.tenantDb.transaction(user.tenantId, async (tx) => {
      const row = await tx.equipment.findUnique({
        where: { id },
        include: {
          vendor: { select: { id: true, name: true } },
          allocations: {
            orderBy: { fromDate: 'desc' },
            include: {
              project: { select: { id: true, name: true } },
              costCode: { select: { id: true, code: true, name: true } },
            },
          },
          servicePlans: { orderBy: { createdAt: 'asc' } },
          documents: { where: { deletedAt: null }, select: { expiresOn: true } },
        },
      });
      return row;
    });
    if (!machine) throw ApiError.notFound('Equipment');
    const open = machine.allocations.filter((allocation) => allocation.toDate === null);
    const view = this.equipment.view(user, { ...machine, allocations: open, servicePlans: machine.servicePlans.filter((plan) => plan.active) }, today);
    const from = addDays(today, -29);
    const [logs, maintenance, documents, cost, utilisation] = await Promise.all([
      this.logs.list(user, { equipment_id: id, limit: 60 }),
      can(user, 'equipment.view') || can(user, 'equipment.manage')
        ? this.maintenance.list(user, { equipment_id: id, limit: 50 })
        : Promise.resolve({ items: [] }),
      this.equipment.listDocuments(user, id),
      can(user, 'equipment.view') ? this.costs.costs(user, { equipment_id: id, from, to: today }) : Promise.resolve(null),
      can(user, 'equipment.view') ? this.costs.utilisation(user, { equipment_id: id, from, to: today }) : Promise.resolve(null),
    ]);
    return {
      ...view,
      allocations: machine.allocations.map((allocation) => ({
        id: allocation.id,
        project: allocation.project,
        cost_code: allocation.costCode,
        from_date: isoDay(allocation.fromDate),
        to_date: isoDay(allocation.toDate),
        note: allocation.note,
      })),
      service_plans: machine.servicePlans.map((plan) =>
        planView(plan, machine.meterType as EquipmentMeterType, tenthsOf(machine.meterReading), today),
      ),
      logs: logs.items,
      maintenance: maintenance.items,
      documents: documents.items,
      cost,
      utilisation: utilisation?.rows[0] ?? null,
      meter_reading: oneDecimalText(machine.meterReading),
      created_on: utcDateToIsoDate(machine.createdAt),
    };
  }

  @RequiresPermission('equipment.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Edit a machine, its hire terms or its status' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateEquipmentSchema)) body: UpdateEquipmentInput,
  ) {
    return this.equipment.update(user, id, body);
  }

  @RequiresPermission('equipment.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a machine; its history stays' })
  async archive(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.equipment.archive(user, id);
  }

  @RequiresPermission('equipment.manage')
  @Post(':id/allocations')
  @ApiOperation({ summary: 'Put a machine on a site from a date; moving it closes the site it was on' })
  allocate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(allocateEquipmentSchema)) body: AllocateEquipmentInput,
  ) {
    return this.equipment.allocate(user, id, body);
  }

  @RequiresPermission('equipment.manage')
  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a machine off its site: back to the yard or back to the vendor' })
  release(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(releaseEquipmentSchema)) body: ReleaseEquipmentInput,
  ) {
    return this.equipment.release(user, id, body);
  }

  @RequiresPermission('equipment.view', 'equipment.manage')
  @Get(':id/documents')
  @ApiOperation({ summary: 'A machine’s documents and their expiry' })
  listDocuments(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.equipment.listDocuments(user, id);
  }

  @RequiresPermission('equipment.manage')
  @Post(':id/documents')
  @ApiOperation({ summary: 'Add insurance, fitness, registration or an operator licence' })
  addDocument(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createEquipmentDocumentSchema)) body: CreateEquipmentDocumentInput,
  ) {
    return this.equipment.addDocument(user, id, body);
  }

  @RequiresPermission('equipment.manage')
  @Post(':id/service-plans')
  @ApiOperation({ summary: 'Add a service schedule: every so many hours, km or days' })
  addPlan(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createEquipmentServicePlanSchema)) body: CreateEquipmentServicePlanInput,
  ) {
    return this.equipment.addPlan(user, id, body);
  }

  @RequiresPermission('equipment.manage')
  @Post(':id/maintenance')
  @ApiOperation({ summary: 'Record a service or a repair; optionally as an expense on the site' })
  addMaintenance(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createEquipmentMaintenanceSchema)) body: CreateEquipmentMaintenanceInput,
  ) {
    return this.maintenance.create(user, id, body);
  }
}
