import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingExportService } from './accounting-export.service';
import { AccountingSettingsService } from './accounting-settings.service';

/**
 * Accounting exports (roadmap Phase 3: "Accounting: Tally, QuickBooks and Xero, SAP Business One and
 * Oracle NetSuite. Start with export files, then live APIs"). Files only for now: the vouchers and the
 * formats are in @sitebook/shared, this module reads the transactions, keeps the mapping and records
 * each export so nothing is handed over twice.
 */
@Module({
  controllers: [AccountingController],
  providers: [AccountingSettingsService, AccountingExportService],
})
export class AccountingModule {}
