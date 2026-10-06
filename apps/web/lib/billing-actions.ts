'use server';

import { revalidatePath } from 'next/cache';
import { runAction, serverFetch, type ActionResult } from './server-api';
import type { BankTransferInvoice, MudadFile, StartedCheckout } from './billing-types';

/**
 * Saudi payroll files, plan checkout in the company's currency, and bank-transfer invoices. In a
 * file of their own so these writes do not collide with `actions.ts`.
 */

/** Saudi Arabia's WPS payroll file for a period, or the reasons it cannot be made yet. Reads only. */
export async function mudadFile(periodId: string): Promise<ActionResult<MudadFile>> {
  return runAction(() => serverFetch<MudadFile>(`/wage-periods/${periodId}/mudad`));
}

/**
 * A card checkout for a plan, in the company's currency or the US-dollar price. Nothing is granted
 * here — the payment provider's signed webhook does that once the money has cleared.
 */
export async function startPlanCheckout(plan: string): Promise<ActionResult<StartedCheckout>> {
  const result = await runAction(() =>
    serverFetch<StartedCheckout>('/billing/subscribe', { method: 'POST', body: { plan } }),
  );
  if (result.ok) revalidatePath('/settings/billing');
  return result;
}

/** Ask the platform team for an invoice to pay by bank transfer. Applied when they mark it paid. */
export async function requestBankTransfer(input: {
  plan: string;
  note?: string;
}): Promise<ActionResult<BankTransferInvoice>> {
  const result = await runAction(() =>
    serverFetch<BankTransferInvoice>('/billing/bank-transfers', { method: 'POST', body: input }),
  );
  if (result.ok) revalidatePath('/settings/billing');
  return result;
}
