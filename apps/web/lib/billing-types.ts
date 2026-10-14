import type { PlanQuote } from '@sitebook/shared';
import type { WpsFile } from './api-types';

/**
 * Wire types for Saudi payroll files, regional plan pricing and bank-transfer invoices. In a file
 * of their own, like the other modules', so they do not collide with `api-types.ts`.
 */

/** `GET /wage-periods/:id/mudad` — Saudi Arabia's WPS payroll file, or why it cannot be made yet. */
export interface MudadFile extends WpsFile {
  /** Halalas transferred in total, as a string. */
  total: string;
}

/** `GET /billing/plans` — the plans on sale, each priced for this company. */
export interface BillingCatalogue {
  currency: string;
  country: string;
  provider: 'razorpay' | 'stripe';
  billing_configured: boolean;
  /** True where a bank-transfer invoice is offered instead of a card (Bangladesh, Nepal). */
  bank_transfer: boolean;
  items: Array<{
    code: string;
    name: string;
    months: number | null;
    description: string | null;
    badge: string | null;
    highlights: string[];
    /** Null is "contact us": no price in the company's currency, and none in US dollars. */
    quote: PlanQuote | null;
  }>;
}

/** A bank-transfer invoice request, as the company sees it. */
export interface BankTransferInvoice {
  id: string;
  number: string;
  plan: string;
  currency: string;
  amount: string;
  status: 'pending' | 'paid' | 'cancelled';
  note: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  created_at: string;
}

/** The same, as the platform console sees it: with the company it belongs to. */
export interface PlatformBankTransfer extends BankTransferInvoice {
  tenant_id: string;
  tenant_name: string;
  country: string;
  settled_by: string | null;
}

/** `POST /billing/subscribe` once regional pricing is in: the currency actually charged. */
export interface StartedCheckout {
  subscription_id: string;
  checkout_url: string | null;
  dry_run: boolean;
  plan: string;
  amount: string;
  currency?: string;
}
