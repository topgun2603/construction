import { Module } from '@nestjs/common';
import { CompanyGroupsModule } from '../company-groups/company-groups.module';
import { CompanyDeletionService } from './company-deletion.service';
import { DataExportService } from './data-export.service';
import { DataPortabilityController } from './data-portability.controller';
import { LegalService } from './legal.service';
import { PersonDataService } from './person-data.service';
import { PortabilityStorage } from './portability-storage.service';

/**
 * Data export and deletion per company (roadmap Phase 3, compliance): full company exports, deleting
 * a company after a grace period, one person's data, and the DPA acceptance record.
 *
 * Exports the deletion and export services for the worker (which builds exports and runs the sweep)
 * and the platform console (which lists, expedites and cancels deletions).
 */
@Module({
  imports: [CompanyGroupsModule],
  controllers: [DataPortabilityController],
  providers: [PortabilityStorage, DataExportService, CompanyDeletionService, PersonDataService, LegalService],
  exports: [DataExportService, CompanyDeletionService],
})
export class DataPortabilityModule {}
