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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  approvePurchaseInvoiceSchema,
  awardRfqSchema,
  createPurchaseOrderSchema,
  createRfqSchema,
  createVendorSchema,
  decidePurchaseOrderSchema,
  listPurchaseInvoicesQuerySchema,
  listPurchaseOrdersQuerySchema,
  listRfqsQuerySchema,
  listVendorsQuerySchema,
  procurementSettingsSchema,
  receiveGoodsSchema,
  recordPurchaseInvoiceSchema,
  rejectPurchaseInvoiceSchema,
  rejectPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  updateVendorSchema,
  upsertQuoteSchema,
  type ApprovePurchaseInvoiceInput,
  type AwardRfqInput,
  type CreatePurchaseOrderInput,
  type CreateRfqInput,
  type CreateVendorInput,
  type DecidePurchaseOrderInput,
  type ListPurchaseInvoicesQuery,
  type ListPurchaseOrdersQuery,
  type ListRfqsQuery,
  type ListVendorsQuery,
  type ProcurementSettingsInput,
  type ReceiveGoodsInput,
  type RecordPurchaseInvoiceInput,
  type RejectPurchaseInvoiceInput,
  type RejectPurchaseOrderInput,
  type UpdatePurchaseOrderInput,
  type UpdateVendorInput,
  type UpsertQuoteInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ApprovalLimitsService } from './approval-limits.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { RfqsService } from './rfqs.service';
import { VendorsService } from './vendors.service';

/**
 * Procurement (roadmap Phase 2, module 2).
 *
 * Behind `materials` rather than a module name of its own, for the reason cost codes sit behind
 * `projects`: a new name would be missing from every account whose module list was stored before
 * it existed, and buying materials is what the materials module is about.
 */
@ApiTags('procurement')
@RequiresModule('materials')
@Controller()
export class ProcurementController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly rfqs: RfqsService,
    private readonly orders: PurchaseOrdersService,
    private readonly invoices: PurchaseInvoicesService,
    private readonly limits: ApprovalLimitsService,
  ) {}

  // --- suppliers -------------------------------------------------------------------------------

  /** Anyone who raises an order or records an invoice needs the list to pick from. */
  @RequiresPermission('procurement.view', 'procurement.manage', 'vendors.manage', 'procurement.invoices')
  @Get('vendors')
  @ApiOperation({ summary: 'Suppliers, active first' })
  listVendors(@CurrentUser() user: RequestUser, @Query(zodBody(listVendorsQuerySchema)) query: ListVendorsQuery) {
    return this.vendors.list(user, query);
  }

  @RequiresPermission('procurement.view', 'vendors.manage')
  @Get('vendors/:id')
  @ApiOperation({ summary: 'A supplier and what has been ordered from them' })
  getVendor(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.get(user, id);
  }

  @RequiresPermission('vendors.manage')
  @Post('vendors')
  @ApiOperation({ summary: 'Add a supplier' })
  createVendor(@CurrentUser() user: RequestUser, @Body(zodBody(createVendorSchema)) body: CreateVendorInput) {
    return this.vendors.create(user, body);
  }

  @RequiresPermission('vendors.manage')
  @Patch('vendors/:id')
  @ApiOperation({ summary: 'Edit a supplier, or mark them inactive' })
  updateVendor(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateVendorSchema)) body: UpdateVendorInput,
  ) {
    return this.vendors.update(user, id, body);
  }

  @RequiresPermission('vendors.manage')
  @Delete('vendors/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a supplier nothing was ever ordered from' })
  async removeVendor(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.vendors.remove(user, id);
  }

  // --- requests for quotation ------------------------------------------------------------------

  @RequiresPermission('procurement.view', 'procurement.manage')
  @Get('rfqs')
  @ApiOperation({ summary: 'Requests for quotation' })
  listRfqs(@CurrentUser() user: RequestUser, @Query(zodBody(listRfqsQuerySchema)) query: ListRfqsQuery) {
    return this.rfqs.list(user, query);
  }

  @RequiresPermission('procurement.view', 'procurement.manage')
  @Get('rfqs/:id')
  @ApiOperation({ summary: 'An RFQ, its quotes, and the side-by-side comparison' })
  getRfq(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfqs.get(user, id);
  }

  @RequiresPermission('procurement.manage')
  @Post('rfqs')
  @ApiOperation({ summary: 'Ask for quotes, from scratch or from an approved indent' })
  createRfq(@CurrentUser() user: RequestUser, @Body(zodBody(createRfqSchema)) body: CreateRfqInput) {
    return this.rfqs.create(user, body);
  }

  @RequiresPermission('procurement.manage')
  @Put('rfqs/:id/quotes')
  @ApiOperation({ summary: 'Enter or replace one supplier’s quote' })
  upsertQuote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(upsertQuoteSchema)) body: UpsertQuoteInput,
  ) {
    return this.rfqs.upsertQuote(user, id, body);
  }

  @RequiresPermission('procurement.manage')
  @Delete('rfqs/:id/quotes/:quoteId')
  @ApiOperation({ summary: 'Remove a quote' })
  removeQuote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ) {
    return this.rfqs.removeQuote(user, id, quoteId);
  }

  @RequiresPermission('procurement.manage')
  @Post('rfqs/:id/award')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pick the winning quote; makes a draft purchase order' })
  award(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(awardRfqSchema)) body: AwardRfqInput,
  ) {
    return this.rfqs.award(user, id, body);
  }

  @RequiresPermission('procurement.manage')
  @Post('rfqs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open RFQ' })
  cancelRfq(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfqs.cancel(user, id);
  }

  // --- purchase orders -------------------------------------------------------------------------

  /** Receivers see the orders they sign deliveries against, without the prices. */
  @RequiresPermission('procurement.view', 'procurement.manage', 'procurement.receive')
  @Get('purchase-orders')
  @ApiOperation({ summary: 'Purchase orders, newest first' })
  listOrders(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listPurchaseOrdersQuerySchema)) query: ListPurchaseOrdersQuery,
  ) {
    return this.orders.list(user, query);
  }

  @RequiresPermission('procurement.view')
  @Get('purchase-orders/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="purchase-orders.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The filtered purchase orders as CSV' })
  exportOrders(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listPurchaseOrdersQuerySchema)) query: ListPurchaseOrdersQuery,
  ) {
    return this.orders.exportCsv(user, query);
  }

  @RequiresPermission('procurement.view', 'procurement.manage', 'procurement.receive')
  @Get('purchase-orders/:id')
  @ApiOperation({ summary: 'One order: lines, receipts, invoices, and who can approve it' })
  getOrder(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  @RequiresPermission('procurement.manage')
  @Post('purchase-orders')
  @ApiOperation({ summary: 'Raise a draft purchase order' })
  createOrder(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createPurchaseOrderSchema)) body: CreatePurchaseOrderInput,
  ) {
    return this.orders.create(user, body);
  }

  @RequiresPermission('procurement.manage')
  @Patch('purchase-orders/:id')
  @ApiOperation({ summary: 'Edit a draft order' })
  updateOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updatePurchaseOrderSchema)) body: UpdatePurchaseOrderInput,
  ) {
    return this.orders.update(user, id, body);
  }

  @RequiresPermission('procurement.manage')
  @Post('purchase-orders/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask for approval; approved at once within the requester’s limit' })
  submit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.submit(user, id);
  }

  @RequiresPermission('procurement.approve')
  @Post('purchase-orders/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve, within the approver’s limit' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(decidePurchaseOrderSchema)) body: DecidePurchaseOrderInput,
  ) {
    return this.orders.approve(user, id, body.note);
  }

  @RequiresPermission('procurement.approve')
  @Post('purchase-orders/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send back to draft with a reason' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(rejectPurchaseOrderSchema)) body: RejectPurchaseOrderInput,
  ) {
    return this.orders.reject(user, id, body.note);
  }

  @RequiresPermission('procurement.manage')
  @Post('purchase-orders/:id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that the order went to the supplier' })
  send(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.send(user, id);
  }

  @RequiresPermission('procurement.manage')
  @Post('purchase-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an order nothing has been received against' })
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(user, id);
  }

  @RequiresPermission('procurement.manage')
  @Post('purchase-orders/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nothing more is coming on this order' })
  close(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.close(user, id);
  }

  @RequiresPermission('procurement.receive')
  @Post('purchase-orders/:id/receipts')
  @ApiOperation({ summary: 'Receive goods against the order; books stock in' })
  receive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(receiveGoodsSchema)) body: ReceiveGoodsInput,
  ) {
    return this.orders.receive(user, id, body);
  }

  // --- supplier invoices -----------------------------------------------------------------------

  @RequiresPermission('procurement.invoices')
  @Post('purchase-orders/:id/invoices')
  @ApiOperation({ summary: 'Record a supplier invoice against the order, and match it' })
  recordInvoice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(recordPurchaseInvoiceSchema)) body: RecordPurchaseInvoiceInput,
  ) {
    return this.invoices.record(user, id, body);
  }

  @RequiresPermission('procurement.view', 'procurement.invoices')
  @Get('purchase-invoices')
  @ApiOperation({ summary: 'Supplier invoices, the ones waiting first' })
  listInvoices(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listPurchaseInvoicesQuerySchema)) query: ListPurchaseInvoicesQuery,
  ) {
    return this.invoices.list(user, query);
  }

  @RequiresPermission('procurement.view', 'procurement.invoices')
  @Get('purchase-invoices/:id')
  @ApiOperation({ summary: 'One invoice and how it matched' })
  getInvoice(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(user, id);
  }

  @RequiresPermission('procurement.invoices', 'procurement.approve')
  @Post('purchase-invoices/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve; books the invoice as expenses on its cost codes' })
  approveInvoice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(approvePurchaseInvoiceSchema)) body: ApprovePurchaseInvoiceInput,
  ) {
    return this.invoices.approve(user, id, body);
  }

  @RequiresPermission('procurement.invoices', 'procurement.approve')
  @Post('purchase-invoices/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an invoice, with the reason' })
  rejectInvoice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(rejectPurchaseInvoiceSchema)) body: RejectPurchaseInvoiceInput,
  ) {
    return this.invoices.reject(user, id, body.note);
  }

  @RequiresPermission('procurement.invoices')
  @Delete('purchase-invoices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an invoice recorded in error (not an approved one)' })
  async removeInvoice(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.invoices.remove(user, id);
  }

  // --- settings --------------------------------------------------------------------------------

  @RequiresPermission('procurement.view', 'procurement.approve', 'tenant.manage')
  @Get('procurement/settings')
  @ApiOperation({ summary: 'Approval limits, the match tolerance, and the caller’s own limit' })
  settings(@CurrentUser() user: RequestUser) {
    return this.limits.settings(user);
  }

  @RequiresPermission('tenant.manage')
  @Put('procurement/settings')
  @ApiOperation({ summary: 'Set the approval limits and the match tolerance' })
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(procurementSettingsSchema)) body: ProcurementSettingsInput,
  ) {
    return this.limits.update(user, body);
  }
}
