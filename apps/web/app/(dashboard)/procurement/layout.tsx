import type { ReactNode } from 'react';
import { requireSelf } from '@/lib/session';
import { ProcurementTabs } from './procurement-tabs';

/**
 * Procurement (roadmap Phase 2, module 2): orders, quotes, supplier invoices, suppliers, and the
 * approval limits. One section with its own tabs, like Settings and Reports.
 */
export default async function ProcurementLayout({ children }: { children: ReactNode }) {
  // Cached per request, so each page below reading it too costs nothing more.
  const me = await requireSelf();
  return (
    <div className="flex flex-col gap-5">
      <ProcurementTabs permissions={me.permissions} />
      {children}
    </div>
  );
}
