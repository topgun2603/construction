import { serverFetch } from '@/lib/server-api';
import { Users } from 'lucide-react';
import type { Contractor, Page } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { DeleteRowButton } from '@/components/delete-row-button';
import { deleteContractor } from '@/lib/actions';
import { titleCase } from '@/lib/format';
import { AddContractorDialog } from './add-contractor-dialog';

export const metadata = { title: 'Contractors · BUILDR' };

export default async function ContractorsPage() {
  const contractors = await serverFetch<Page<Contractor>>('/contractors?limit=200');

  return (
    <FadeIn className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
          Each contractor gets their own wage period. Workers with no contractor are paid as
          direct labour, which is its own group.
        </p>
        <AddContractorDialog />
      </div>

      {contractors.items.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No contractors yet"
          body="Add the gangs you subcontract to, so their wage sheets stay separate."
          action={<AddContractorDialog />}
        />
      ) : (
        <Card className="divide-y divide-line-soft">
          {contractors.items.map((contractor) => (
            <div key={contractor.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-medium">{contractor.name}</span>
                <span className="text-[12.5px] text-ink-muted">
                  {contractor.trade ?? 'No trade'}
                  {contractor.phone && ` · +${contractor.phone}`}
                </span>
              </div>
              <div className="flex flex-none items-center gap-3">
                <span className="font-mono text-[13px] text-ink-muted">
                  {contractor.worker_count} workers
                </span>
                <Badge tone="neutral" dot={false}>
                  Paid {titleCase(contractor.payment_terms)}
                </Badge>
                <DeleteRowButton
                  what={contractor.name}
                  title="Delete this contractor?"
                  body={
                    <>
                      <strong className="font-semibold text-ink">{contractor.name}</strong> comes
                      off the list.{' '}
                      {contractor.worker_count > 0
                        ? `Their ${contractor.worker_count} workers stay on the roster and move to direct labour.`
                        : 'Past wage sheets keep their record.'}
                    </>
                  }
                  successMessage={`${contractor.name} deleted`}
                  onConfirm={deleteContractor.bind(null, contractor.id)}
                />
              </div>
            </div>
          ))}
        </Card>
      )}
    </FadeIn>
  );
}
