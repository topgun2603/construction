import { Module } from '@nestjs/common';
import { ExcelController } from './excel.controller';
import { ExcelExportService } from './excel-export.service';
import { ExportsService } from './exports.service';
import { ImportService } from './import.service';

/**
 * Excel export on every table and Excel import with templates (roadmap Phase 3, item 4).
 *
 * Imports no feature module: the list and create services it drives are looked up through
 * `ModuleRef` (see `ExportsService`), so this module depends on nothing and nothing depends on it.
 * `ExcelExportService` is exported for any module that wants to render its own report as a sheet.
 */
@Module({
  controllers: [ExcelController],
  providers: [ExcelExportService, ExportsService, ImportService],
  exports: [ExcelExportService],
})
export class ExcelModule {}
