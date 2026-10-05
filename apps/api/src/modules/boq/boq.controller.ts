import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  boqAutoMapSchema,
  boqExportQuerySchema,
  boqImportSchema,
  boqMeasurementSchema,
  boqTermsSchema,
  certifyBoqBillSchema,
  createBoqBillSchema,
  createBoqItemSchema,
  invoiceBoqBillSchema,
  returnBoqBillSchema,
  updateBoqBillSchema,
  updateBoqItemSchema,
  type BoqAutoMapInput,
  type BoqExportQuery,
  type BoqImportInput,
  type BoqMeasurementInput,
  type BoqTermsInput,
  type CertifyBoqBillInput,
  type CreateBoqBillInput,
  type CreateBoqItemInput,
  type InvoiceBoqBillInput,
  type ReturnBoqBillInput,
  type UpdateBoqBillInput,
  type UpdateBoqItemInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { BoqBillsService } from './boq-bills.service';
import { BoqMeasurementsService } from './boq-measurements.service';
import { BoqService } from './boq.service';

/**
 * Bill of quantities (roadmap Phase 2, module 5).
 *
 * Behind `projects`, like cost codes and subcontracts: a BOQ is part of a site, and a new module
 * name would be missing from every account whose module list was stored before it existed.
 *
 * Reading the BOQ takes `view`, `measure` or `bill`; the service strips the money for somebody who
 * only measures.
 */
@ApiTags('bill of quantities')
@RequiresModule('projects')
@Controller()
export class BoqController {
  constructor(
    private readonly boq: BoqService,
    private readonly measurements: BoqMeasurementsService,
    private readonly bills: BoqBillsService,
  ) {}

  @RequiresPermission('boq.view', 'boq.measure', 'boq.bill')
  @Get('projects/:projectId/boq')
  @ApiOperation({ summary: 'The site’s BOQ: items with progress, the abstract and the bills' })
  get(@CurrentUser() user: RequestUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.boq.get(user, projectId);
  }

  @RequiresPermission('boq.manage')
  @Patch('projects/:projectId/boq')
  @ApiOperation({ summary: 'Title and the client’s billing terms: retention, advance, tax' })
  updateTerms(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(boqTermsSchema)) body: BoqTermsInput,
  ) {
    return this.boq.updateTerms(user, projectId, body);
  }

  @RequiresPermission('boq.manage')
  @Post('projects/:projectId/boq/import/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read an .xlsx or .csv BOQ and show what importing it would do' })
  previewImport(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(boqImportSchema)) body: BoqImportInput,
  ) {
    return this.boq.previewImport(user, projectId, body);
  }

  @RequiresPermission('boq.manage')
  @Post('projects/:projectId/boq/import')
  @ApiOperation({ summary: 'Import a BOQ: every row, or nothing' })
  import(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(boqImportSchema)) body: BoqImportInput,
  ) {
    return this.boq.import(user, projectId, body);
  }

  @RequiresPermission('boq.view')
  @Get('projects/:projectId/boq/export')
  @ApiOperation({ summary: 'The BOQ or its abstract as .xlsx or CSV' })
  async export(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query(zodBody(boqExportQuerySchema)) query: BoqExportQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.boq.export(user, projectId, query);
    response.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.body);
  }

  @RequiresPermission('boq.manage')
  @Post('projects/:projectId/boq/items')
  @ApiOperation({ summary: 'Add a section or an item by hand' })
  addItem(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(createBoqItemSchema)) body: CreateBoqItemInput,
  ) {
    return this.boq.addItem(user, projectId, body);
  }

  @RequiresPermission('boq.manage')
  @Post('projects/:projectId/boq/auto-map')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Propose (or apply) a cost code for each item by code and name' })
  autoMap(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(boqAutoMapSchema)) body: BoqAutoMapInput,
  ) {
    return this.boq.autoMapCostCodes(user, projectId, body);
  }

  @RequiresPermission('boq.manage')
  @Patch('boq-items/:itemId')
  @ApiOperation({ summary: 'Edit an item; its rate is fixed once the client has certified work at it' })
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(zodBody(updateBoqItemSchema)) body: UpdateBoqItemInput,
  ) {
    return this.boq.updateItem(user, itemId, body);
  }

  @RequiresPermission('boq.manage')
  @Delete('boq-items/:itemId')
  @ApiOperation({ summary: 'Remove an item nothing has been measured or billed against' })
  removeItem(@CurrentUser() user: RequestUser, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.boq.removeItem(user, itemId);
  }

  // --- measurement book --------------------------------------------------------------------------

  @RequiresPermission('boq.view', 'boq.measure')
  @Get('boq-items/:itemId/measurements')
  @ApiOperation({ summary: 'The measurement book for one item' })
  listMeasurements(@CurrentUser() user: RequestUser, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.measurements.list(user, itemId);
  }

  @RequiresPermission('boq.measure', 'boq.manage')
  @Post('boq-items/:itemId/measurements')
  @ApiOperation({ summary: 'Record work measured on site against an item' })
  measure(
    @CurrentUser() user: RequestUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(zodBody(boqMeasurementSchema)) body: BoqMeasurementInput,
  ) {
    return this.measurements.create(user, itemId, body);
  }

  @RequiresPermission('boq.measure', 'boq.manage')
  @Delete('boq-measurements/:measurementId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a measurement recorded in error' })
  async removeMeasurement(
    @CurrentUser() user: RequestUser,
    @Param('measurementId', ParseUUIDPipe) measurementId: string,
  ): Promise<void> {
    await this.measurements.remove(user, measurementId);
  }

  // --- bills to the client -----------------------------------------------------------------------

  @RequiresPermission('boq.bill')
  @Post('projects/:projectId/boq/bills')
  @ApiOperation({ summary: 'Draft the next running bill to the client from what is measured' })
  createBill(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(createBoqBillSchema)) body: CreateBoqBillInput,
  ) {
    return this.bills.create(user, projectId, body);
  }

  @RequiresPermission('boq.view', 'boq.bill')
  @Get('boq-bills/:billId')
  @ApiOperation({ summary: 'One bill to the client, item by item' })
  getBill(@CurrentUser() user: RequestUser, @Param('billId', ParseUUIDPipe) billId: string) {
    return this.bills.get(user, billId);
  }

  @RequiresPermission('boq.bill')
  @Patch('boq-bills/:billId')
  @ApiOperation({ summary: 'Edit a draft bill' })
  updateBill(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(updateBoqBillSchema)) body: UpdateBoqBillInput,
  ) {
    return this.bills.update(user, billId, body);
  }

  @RequiresPermission('boq.bill')
  @Delete('boq-bills/:billId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft bill' })
  async removeBill(@CurrentUser() user: RequestUser, @Param('billId', ParseUUIDPipe) billId: string): Promise<void> {
    await this.bills.remove(user, billId);
  }

  @RequiresPermission('boq.bill')
  @Post('boq-bills/:billId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the bill as sent to the client' })
  submit(@CurrentUser() user: RequestUser, @Param('billId', ParseUUIDPipe) billId: string) {
    return this.bills.submit(user, billId);
  }

  @RequiresPermission('boq.bill')
  @Post('boq-bills/:billId/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Back to draft, with the reason' })
  returnBill(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(returnBoqBillSchema)) body: ReturnBoqBillInput,
  ) {
    return this.bills.returnToDraft(user, billId, body);
  }

  @RequiresPermission('boq.bill')
  @Post('boq-bills/:billId/certify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record what the client certified, item by item' })
  certify(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(certifyBoqBillSchema)) body: CertifyBoqBillInput,
  ) {
    return this.bills.certify(user, billId, body);
  }

  @RequiresPermission('boq.bill')
  @Post('boq-bills/:billId/invoice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Raise the certified bill as an instalment in the payment schedule' })
  invoice(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(invoiceBoqBillSchema)) body: InvoiceBoqBillInput,
  ) {
    return this.bills.invoice(user, billId, body);
  }
}
