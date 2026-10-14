'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PURCHASE_ORDER_STATUSES } from '@sitebook/shared';
import type { ProjectSummary } from '@/lib/api-types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { ORDER_STATUS } from './status';

const ALL = 'all';

/** Site and status filters, kept in the URL so a filtered list can be shared and exported. */
export function OrderFilters({ projects }: { projects: ProjectSummary[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Select value={params.get('project_id') ?? ALL} onValueChange={(value) => set('project_id', value)}>
        <SelectTrigger aria-label={t('Site')} className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('All sites')}</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get('status') ?? ALL} onValueChange={(value) => set('status', value)}>
        <SelectTrigger aria-label={t('Status')} className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('Every status')}</SelectItem>
          {PURCHASE_ORDER_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {t(ORDER_STATUS[status].label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
