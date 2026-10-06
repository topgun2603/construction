'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from './server-api';
import { platformFetch } from './platform-session';

/**
 * The console's side of regional pricing and bank-transfer invoices. Kept apart from
 * `platform-actions.ts` so the two do not collide.
 */

/** Sets a plan's prices in other currencies — the whole map, as the region pricing view edits it. */
export async function setPlanPrices(
  id: string,
  prices: Record<string, string>,
): Promise<ActionResult> {
  const result = await runAction(() =>
    platformFetch(`/plans/${id}`, { method: 'PATCH', body: { prices } }),
  );
  if (result.ok) revalidatePath('/admin/plans');
  return result;
}

/** Marks a bank-transfer invoice paid (the plan applies) or cancelled. Root operators only. */
export async function settleBankTransfer(
  id: string,
  input: { status: 'paid' | 'cancelled'; payment_reference?: string },
): Promise<ActionResult> {
  const result = await runAction(() =>
    platformFetch(`/bank-transfers/${id}/settle`, { method: 'POST', body: input }),
  );
  if (result.ok) {
    revalidatePath('/admin/bank-transfers');
    revalidatePath('/admin/tenants');
  }
  return result;
}
