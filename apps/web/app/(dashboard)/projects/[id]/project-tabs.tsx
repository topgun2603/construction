'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

export function ProjectTabs({
  projectId,
  active,
  reportCount,
  showMaterials = false,
  showConversation = false,
  showDocuments = false,
  unreadCount = 0,
}: {
  projectId: string;
  active: string;
  reportCount: number;
  /** Materials is behind the `stock` module; a tab that opens onto a 403 is worse than no tab. */
  showMaterials?: boolean;
  /** The conversation is behind `client_portal`, documents behind `documents`. Same reasoning. */
  showConversation?: boolean;
  showDocuments?: boolean;
  unreadCount?: number;
}) {
  const tabs = [
    { key: 'timeline', label: 'Timeline' },
    { key: 'reports', label: 'Daily reports', count: reportCount },
    ...(showConversation
      ? [{ key: 'conversation', label: 'Conversation', count: unreadCount }]
      : []),
    ...(showDocuments ? [{ key: 'documents', label: 'Documents' }] : []),
    { key: 'people', label: 'People' },
    ...(showMaterials ? [{ key: 'materials', label: 'Materials' }] : []),
  ];

  return (
    <nav className="flex gap-1 border-b border-line">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`/projects/${projectId}?tab=${tab.key}`}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] leading-tight transition',
              selected
                ? 'border-accent font-semibold text-ink'
                : 'border-transparent font-medium text-ink-muted hover:text-ink',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <span className="rounded-full bg-neutral-bg px-1.5 font-mono text-[11px] text-ink-soft">
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
