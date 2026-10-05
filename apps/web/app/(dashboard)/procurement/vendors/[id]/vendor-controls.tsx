'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Power } from 'lucide-react';
import { toast } from 'sonner';
import { deleteVendor, updateVendor } from '@/lib/procurement-actions';
import type { Vendor } from '@/lib/procurement-types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/components/language-provider';
import { VendorFormDialog } from '../vendor-form-dialog';

/** Edit, mark inactive (or active again), and delete one nothing was ever ordered from. */
export function VendorControls({ vendor, hasHistory }: { vendor: Vendor; hasHistory: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <VendorFormDialog
        vendor={vendor}
        trigger={
          <Button size="sm" variant="secondary">
            <Pencil className="size-4" /> {t('Edit')}
          </Button>
        }
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await updateVendor(vendor.id, { active: !vendor.active });
            if (!result.ok) toast.error(result.error ?? t('That did not work'));
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
        {vendor.active ? t('Mark inactive') : t('Mark active')}
      </Button>
      {!hasHistory && (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="destructive">
              {t('Delete')}
            </Button>
          }
          title={`${t('Delete')} ${vendor.name}?`}
          body={t('Nothing has been ordered from this supplier, so nothing else changes.')}
          onConfirm={async () => {
            const result = await deleteVendor(vendor.id);
            if (result.ok) router.push('/procurement/vendors');
            return result;
          }}
        />
      )}
    </div>
  );
}
