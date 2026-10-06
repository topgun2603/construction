'use client';

import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/components/language-provider';
import type { SiteDocument } from '@/lib/api-types';

/**
 * Pick drawings and documents from the library — a specific revision of each — for an RFI to refer
 * to or a submittal to carry. Only the chosen site's documents and the company-wide ones are offered.
 */
export function DocumentPicker({
  documents,
  projectId,
  value,
  onChange,
}: {
  documents: SiteDocument[];
  projectId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState('');
  const offered = useMemo(
    () =>
      documents
        .filter((document) => document.project_id === projectId || document.project_id === null)
        .filter((document) => document.title.toLowerCase().includes(filter.trim().toLowerCase())),
    [documents, projectId, filter],
  );
  const chosen = new Set(value);

  if (documents.length === 0) {
    return <p className="text-[12.5px] text-ink-faint">{t('No documents in the library yet.')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t('Find a drawing')}
        aria-label={t('Find a drawing')}
      />
      <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-btn border border-line p-1">
        {offered.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-ink-faint">{t('Nothing matches.')}</li>}
        {offered.map((document) => (
          <li key={document.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[13px] hover:bg-raised">
              <input
                type="checkbox"
                checked={chosen.has(document.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...value, document.id] : value.filter((id) => id !== document.id),
                  )
                }
              />
              <FileText className="size-3.5 flex-none text-ink-muted" />
              <span className="truncate">{document.title}</span>
              <span className="ms-auto flex-none font-mono text-[11.5px] text-ink-faint" dir="ltr">
                v{document.version}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
