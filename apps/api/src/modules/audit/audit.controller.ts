import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema, type AuditQuery } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

/** The audit log: every create, update and delete, and the approvals and payments by name. */
@ApiTags('audit')
@RequiresPermission('audit.view')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Audit entries, newest first, filtered and keyset-paged' })
  list(@CurrentUser() user: RequestUser, @Query(zodBody(auditQuerySchema)) query: AuditQuery) {
    return this.audit.list(user, query);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The filtered audit log as CSV' })
  export(@CurrentUser() user: RequestUser, @Query(zodBody(auditQuerySchema)) query: AuditQuery) {
    return this.audit.exportCsv(user, query);
  }
}
