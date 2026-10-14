'use server';

import { revalidatePath } from 'next/cache';
import type {
  AccountingDefaultsInput,
  AccountingExportInput,
  AccountingMappingInput,
  AccountingSettingsInput,
} from '@sitebook/shared';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { AccountingBatch, AccountingOverview, AccountingPreview } from './accounting-types';

/**
 * Accounting exports: Settings → Accounting and Reports → Export to accounts. The API decides
 * everything — what is mapped, what goes in a file, what was exported before; these carry the form
 * there and bring the answer back.
 */

export async function saveAccountingSettings(input: AccountingSettingsInput): Promise<ActionResult<AccountingOverview>> {
  const result = await runAction(() => serverFetch<AccountingOverview>('/accounting/settings', { method: 'PUT', body: input }));
  if (result.ok) revalidatePath('/settings/accounting');
  return result;
}

export async function saveAccountingMappings(input: AccountingMappingInput): Promise<ActionResult<AccountingOverview>> {
  const result = await runAction(() => serverFetch<AccountingOverview>('/accounting/mappings', { method: 'PUT', body: input }));
  if (result.ok) revalidatePath('/settings/accounting');
  return result;
}

export async function applyAccountingDefaults(input: AccountingDefaultsInput): Promise<ActionResult<AccountingOverview>> {
  const result = await runAction(() =>
    serverFetch<AccountingOverview>('/accounting/mappings/defaults', { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath('/settings/accounting');
  return result;
}

export async function previewAccountingExport(input: AccountingExportInput): Promise<ActionResult<AccountingPreview>> {
  return runAction(() => serverFetch<AccountingPreview>('/accounting/preview', { method: 'POST', body: input }));
}

export async function createAccountingExport(input: AccountingExportInput): Promise<ActionResult<AccountingBatch>> {
  const result = await runAction(() => serverFetch<AccountingBatch>('/accounting/exports', { method: 'POST', body: input }));
  if (result.ok) revalidatePath('/reports/accounts-export');
  return result;
}
