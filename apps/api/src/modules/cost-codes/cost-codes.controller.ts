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
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyCostCodeTemplateSchema,
  costCodeTemplateIdSchema,
  createCostCodeSchema,
  createCostCodeTemplateSchema,
  importCostCodesSchema,
  updateCostCodeSchema,
  updateCostCodeTemplateSchema,
  type ApplyCostCodeTemplateInput,
  type CreateCostCodeInput,
  type CreateCostCodeTemplateInput,
  type ImportCostCodesInput,
  type UpdateCostCodeInput,
  type UpdateCostCodeTemplateInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CostCodesService } from './cost-codes.service';
import { CostReportService } from './cost-report.service';

/**
 * Cost codes and budgets (roadmap Phase 2, module 1).
 *
 * Behind `projects` rather than a module of its own: a breakdown is part of a site, and a new module
 * name would be missing from every account whose module list was stored before it existed.
 */
@ApiTags('cost-codes')
@RequiresModule('projects')
@Controller()
export class CostCodesController {
  constructor(
    private readonly codes: CostCodesService,
    private readonly reports: CostReportService,
  ) {}

  /** Recording an expense needs the list to pick from; the budgets are stripped without `view`. */
  @RequiresPermission('cost_codes.view', 'expenses.record')
  @Get('projects/:projectId/cost-codes')
  @ApiOperation({ summary: 'A site’s cost codes, in tree order' })
  list(@CurrentUser() user: RequestUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.codes.list(user, projectId);
  }

  @RequiresPermission('cost_codes.manage')
  @Post('projects/:projectId/cost-codes')
  @ApiOperation({ summary: 'Add a cost code to a site' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(createCostCodeSchema)) body: CreateCostCodeInput,
  ) {
    return this.codes.create(user, projectId, body);
  }

  @RequiresPermission('cost_codes.manage')
  @Patch('projects/:projectId/cost-codes/:id')
  @ApiOperation({ summary: 'Rename, move or re-budget a cost code' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateCostCodeSchema)) body: UpdateCostCodeInput,
  ) {
    return this.codes.update(user, projectId, id, body);
  }

  @RequiresPermission('cost_codes.manage')
  @Delete('projects/:projectId/cost-codes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a cost code nothing is booked to' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.codes.remove(user, projectId, id);
  }

  @RequiresPermission('cost_codes.manage')
  @Post('projects/:projectId/cost-codes/apply-template')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Copy a template’s codes into a site; existing codes are left alone' })
  applyTemplate(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(applyCostCodeTemplateSchema)) body: ApplyCostCodeTemplateInput,
  ) {
    return this.codes.applyTemplate(user, projectId, body.template_id);
  }

  @RequiresPermission('cost_codes.manage')
  @Post('projects/:projectId/cost-codes/import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add or update codes and budgets from a parsed spreadsheet' })
  import(
    @CurrentUser() user: RequestUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(zodBody(importCostCodesSchema)) body: ImportCostCodesInput,
  ) {
    return this.codes.import(user, projectId, body);
  }

  @RequiresPermission('cost_codes.view')
  @Get('projects/:projectId/cost-report')
  @ApiOperation({ summary: 'Budget vs committed vs actual vs forecast, rolled up the tree' })
  report(@CurrentUser() user: RequestUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.reports.report(user, projectId);
  }

  // --- the company's template library ---------------------------------------------------------

  @RequiresPermission('cost_codes.view')
  @Get('cost-code-templates')
  @ApiOperation({ summary: 'The built-in template and the company’s own' })
  listTemplates(@CurrentUser() user: RequestUser) {
    return this.codes.listTemplates(user);
  }

  @RequiresPermission('cost_codes.view')
  @Get('cost-code-templates/:id')
  @ApiOperation({ summary: 'One template and its lines' })
  getTemplate(@CurrentUser() user: RequestUser, @Param('id', zodBody(costCodeTemplateIdSchema)) id: string) {
    return this.codes.getTemplate(user, id);
  }

  @RequiresPermission('cost_codes.manage')
  @Post('cost-code-templates')
  @ApiOperation({ summary: 'Make a template: empty, copied, from a site, or from the lines given' })
  createTemplate(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createCostCodeTemplateSchema)) body: CreateCostCodeTemplateInput,
  ) {
    return this.codes.createTemplate(user, body);
  }

  @RequiresPermission('cost_codes.manage')
  @Put('cost-code-templates/:id')
  @ApiOperation({ summary: 'Rename a template or replace its lines' })
  updateTemplate(
    @CurrentUser() user: RequestUser,
    @Param('id', zodBody(costCodeTemplateIdSchema)) id: string,
    @Body(zodBody(updateCostCodeTemplateSchema)) body: UpdateCostCodeTemplateInput,
  ) {
    return this.codes.updateTemplate(user, id, body);
  }

  @RequiresPermission('cost_codes.manage')
  @Delete('cost-code-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a template; sites started from it keep their codes' })
  async removeTemplate(@CurrentUser() user: RequestUser, @Param('id', zodBody(costCodeTemplateIdSchema)) id: string): Promise<void> {
    await this.codes.removeTemplate(user, id);
  }
}

