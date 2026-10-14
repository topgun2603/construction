import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CompanyDeletionService } from '../../modules/data-portability/company-deletion.service';
import { DataExportService } from '../../modules/data-portability/data-export.service';
import { QUEUE, type DataExportJob } from '../job-types';

/**
 * Company exports and the deletion sweep (data portability, Phase 3).
 *
 * Concurrency 1: an export streams every file a company has ever uploaded, and two at once on one
 * worker would only make both slower while doubling the memory in flight.
 */
@Processor(QUEUE.compliance, { concurrency: 1 })
export class ComplianceProcessor extends WorkerHost {
  private readonly logger = new Logger(ComplianceProcessor.name);

  constructor(
    private readonly exportsService: DataExportService,
    private readonly deletion: CompanyDeletionService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'data-export': {
        const data = job.data as DataExportJob;
        const manifest = await this.exportsService.run(data.tenantId, data.exportId);
        return manifest ? { tables: Object.keys(manifest.tables).length, files: manifest.files.count } : null;
      }
      case 'deletion-sweep':
        return this.deletion.sweep();
      default:
        this.logger.warn({ name: job.name }, 'Unknown compliance job');
        return null;
    }
  }
}
