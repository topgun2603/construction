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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attachSubcontractDocumentSchema,
  certifyRaBillSchema,
  createRaBillSchema,
  createSubcontractSchema,
  createVariationSchema,
  decideVariationSchema,
  listSubcontractsQuerySchema,
  payRaBillSchema,
  releaseRetentionSchema,
  returnRaBillSchema,
  subcontractLineSchema,
  subcontractPaymentSchema,
  subcontractStatusSchema,
  updateRaBillSchema,
  updateSubcontractLineSchema,
  updateSubcontractSchema,
  type AttachSubcontractDocumentInput,
  type CertifyRaBillInput,
  type CreateRaBillInput,
  type CreateSubcontractInput,
  type CreateVariationInput,
  type DecideVariationInput,
  type ListSubcontractsQuery,
  type PayRaBillInput,
  type ReleaseRetentionInput,
  type ReturnRaBillInput,
  type SubcontractLineInput,
  type SubcontractPaymentInput,
  type SubcontractStatusInput,
  type UpdateRaBillInput,
  type UpdateSubcontractInput,
  type UpdateSubcontractLineInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { RaBillsService } from './ra-bills.service';
import { SubcontractsService } from './subcontracts.service';

/**
 * Subcontracts and progress (RA) billing (roadmap Phase 2, module 3).
 *
 * Behind `projects`, like cost codes: a subcontract is part of a site, and a new module name would
 * be missing from every account whose module list was stored before it existed.
 *
 * Reading takes `view` or `measure`: a supervisor measuring work has to see the lines, and the
 * service strips the money when they cannot `view`.
 */
@ApiTags('subcontracts')
@RequiresModule('projects')
@Controller()
export class SubcontractsController {
  constructor(
    private readonly subcontracts: SubcontractsService,
    private readonly bills: RaBillsService,
  ) {}

  @RequiresPermission('subcontracts.view', 'subcontracts.measure')
  @Get('subcontracts')
  @ApiOperation({ summary: 'Subcontracts, company-wide or for one site' })
  list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listSubcontractsQuerySchema)) query: ListSubcontractsQuery,
  ) {
    return this.subcontracts.list(user, query);
  }

  @RequiresPermission('subcontracts.view', 'subcontracts.measure')
  @Get('subcontracts/:id')
  @ApiOperation({ summary: 'One subcontract: lines, variations, bills, retention and its statement' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.subcontracts.get(user, id);
  }

  @RequiresPermission('subcontracts.manage')
  @Post('subcontracts')
  @ApiOperation({ summary: 'Write a subcontract, optionally with its schedule of rates' })
  create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createSubcontractSchema)) body: CreateSubcontractInput,
  ) {
    return this.subcontracts.create(user, body);
  }

  @RequiresPermission('subcontracts.manage')
  @Patch('subcontracts/:id')
  @ApiOperation({ summary: 'Edit a subcontract; price terms only while it is a draft' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSubcontractSchema)) body: UpdateSubcontractInput,
  ) {
    return this.subcontracts.update(user, id, body);
  }

  @RequiresPermission('subcontracts.manage')
  @Delete('subcontracts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft subcontract' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.subcontracts.remove(user, id);
  }

  @RequiresPermission('subcontracts.manage')
  @Post('subcontracts/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Let, complete, close or terminate a subcontract' })
  setStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(subcontractStatusSchema)) body: SubcontractStatusInput,
  ) {
    return this.subcontracts.setStatus(user, id, body);
  }

  // --- schedule of rates -------------------------------------------------------------------------

  @RequiresPermission('subcontracts.manage')
  @Post('subcontracts/:id/lines')
  @ApiOperation({ summary: 'Add a line to a draft subcontract' })
  addLine(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(subcontractLineSchema)) body: SubcontractLineInput,
  ) {
    return this.subcontracts.addLine(user, id, body);
  }

  @RequiresPermission('subcontracts.manage')
  @Patch('subcontracts/:id/lines/:lineId')
  @ApiOperation({ summary: 'Edit a line of a draft subcontract' })
  updateLine(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body(zodBody(updateSubcontractLineSchema)) body: UpdateSubcontractLineInput,
  ) {
    return this.subcontracts.updateLine(user, id, lineId, body);
  }

  @RequiresPermission('subcontracts.manage')
  @Delete('subcontracts/:id/lines/:lineId')
  @ApiOperation({ summary: 'Remove a line from a draft subcontract' })
  removeLine(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.subcontracts.removeLine(user, id, lineId);
  }

  // --- variations --------------------------------------------------------------------------------

  @RequiresPermission('subcontracts.manage')
  @Post('subcontracts/:id/variations')
  @ApiOperation({ summary: 'Propose a variation: extra lines, pending approval' })
  createVariation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createVariationSchema)) body: CreateVariationInput,
  ) {
    return this.subcontracts.createVariation(user, id, body);
  }

  @RequiresPermission('subcontracts.certify')
  @Post('subcontracts/:id/variations/:variationId/decide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a variation; approval raises the contract value' })
  decideVariation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variationId', ParseUUIDPipe) variationId: string,
    @Body(zodBody(decideVariationSchema)) body: DecideVariationInput,
  ) {
    return this.subcontracts.decideVariation(user, id, variationId, body);
  }

  // --- retention, payments, documents ------------------------------------------------------------

  @RequiresPermission('subcontracts.certify')
  @Post('subcontracts/:id/retention-releases')
  @ApiOperation({ summary: 'Release retention held; it becomes payable' })
  releaseRetention(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(releaseRetentionSchema)) body: ReleaseRetentionInput,
  ) {
    return this.subcontracts.releaseRetention(user, id, body);
  }

  @RequiresPermission('subcontracts.pay')
  @Post('subcontracts/:id/payments')
  @ApiOperation({ summary: 'Pay the advance or released retention' })
  recordPayment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(subcontractPaymentSchema)) body: SubcontractPaymentInput,
  ) {
    return this.subcontracts.recordPayment(user, id, body);
  }

  @RequiresPermission('subcontracts.manage')
  @Post('subcontracts/:id/documents')
  @ApiOperation({ summary: 'Link a document from the library' })
  attachDocument(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(attachSubcontractDocumentSchema)) body: AttachSubcontractDocumentInput,
  ) {
    return this.subcontracts.attachDocument(user, id, body.document_id);
  }

  @RequiresPermission('subcontracts.manage')
  @Delete('subcontracts/:id/documents/:documentId')
  @ApiOperation({ summary: 'Unlink a document; the document itself stays in the library' })
  detachDocument(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.subcontracts.detachDocument(user, id, documentId);
  }

  // --- RA bills ----------------------------------------------------------------------------------

  @RequiresPermission('subcontracts.manage', 'subcontracts.measure')
  @Post('subcontracts/:id/bills')
  @ApiOperation({ summary: 'Draft the next RA bill: work done to date per line, and back-charges' })
  createBill(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createRaBillSchema)) body: CreateRaBillInput,
  ) {
    return this.bills.create(user, id, body);
  }

  @RequiresPermission('subcontracts.view', 'subcontracts.measure')
  @Get('subcontract-bills/:billId')
  @ApiOperation({ summary: 'One RA bill, line by line — the editor and the printed certificate' })
  getBill(@CurrentUser() user: RequestUser, @Param('billId', ParseUUIDPipe) billId: string) {
    return this.bills.get(user, billId);
  }

  @RequiresPermission('subcontracts.manage', 'subcontracts.measure')
  @Patch('subcontract-bills/:billId')
  @ApiOperation({ summary: 'Re-measure a draft RA bill' })
  updateBill(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(updateRaBillSchema)) body: UpdateRaBillInput,
  ) {
    return this.bills.update(user, billId, body);
  }

  @RequiresPermission('subcontracts.manage', 'subcontracts.measure')
  @Delete('subcontract-bills/:billId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft RA bill' })
  async removeBill(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
  ): Promise<void> {
    await this.bills.remove(user, billId);
  }

  @RequiresPermission('subcontracts.manage', 'subcontracts.measure')
  @Post('subcontract-bills/:billId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a draft RA bill for certification' })
  submitBill(@CurrentUser() user: RequestUser, @Param('billId', ParseUUIDPipe) billId: string) {
    return this.bills.submit(user, billId);
  }

  @RequiresPermission('subcontracts.certify')
  @Post('subcontract-bills/:billId/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a submitted RA bill back to be re-measured' })
  returnBill(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(returnRaBillSchema)) body: ReturnRaBillInput,
  ) {
    return this.bills.returnToDraft(user, billId, body);
  }

  @RequiresPermission('subcontracts.certify')
  @Post('subcontract-bills/:billId/certify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Certify an RA bill, for the quantities agreed — at most those claimed' })
  certifyBill(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(certifyRaBillSchema)) body: CertifyRaBillInput,
  ) {
    return this.bills.certify(user, billId, body);
  }

  @RequiresPermission('subcontracts.pay')
  @Post('subcontract-bills/:billId/payments')
  @ApiOperation({ summary: 'Record a payment against a certified RA bill' })
  payBill(
    @CurrentUser() user: RequestUser,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(payRaBillSchema)) body: PayRaBillInput,
  ) {
    return this.bills.pay(user, billId, body);
  }
}
