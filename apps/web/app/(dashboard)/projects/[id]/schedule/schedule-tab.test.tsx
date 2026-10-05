import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleTask, ScheduleView } from '@/lib/schedule-types';
import { LanguageProvider } from '@/components/language-provider';

vi.mock('@/lib/schedule-actions', () => ({}));

import { ScheduleTab } from './schedule-tab';

function task(over: Partial<ScheduleTask>): ScheduleTask {
  return {
    id: 't',
    parent_id: null,
    depth: 0,
    wbs: '1',
    wbs_code: null,
    name: 'Task',
    kind: 'task',
    is_summary: false,
    sort_order: 0,
    duration_days: 3,
    constraint_type: 'asap',
    constraint_date: null,
    percent_complete: 0,
    actual_start: null,
    actual_finish: null,
    start: '2026-03-02',
    finish: '2026-03-04',
    late_start: '2026-03-02',
    late_finish: '2026-03-04',
    total_float: 0,
    free_float: 0,
    critical: true,
    status: 'not_started',
    behind: false,
    cost_code: null,
    responsible: null,
    contractor: null,
    milestone: null,
    notes: null,
    baseline: null,
    ...over,
  };
}

function view(over: Partial<ScheduleView> = {}): ScheduleView {
  return {
    project: { id: 'p1', name: 'Villa', start_date: '2026-03-02', target_end_date: '2026-04-30' },
    status_date: '2026-03-03',
    project_start: '2026-03-02',
    finish_date: '2026-03-09',
    calendar: { id: null, scope: 'default', name: 'Standard', working_days: [1, 2, 3, 4, 5], holidays: [] },
    tasks: [
      task({ id: 'a', wbs: '1', name: 'Footings' }),
      task({ id: 'b', wbs: '2', name: 'Slab', start: '2026-03-09', finish: '2026-03-11', behind: true }),
    ],
    dependencies: [{ id: 'd1', predecessor_id: 'a', successor_id: 'b', type: 'FS', lag_days: 0 }],
    critical_path: ['a', 'b'],
    baselines: [],
    baseline: null,
    unlinked_milestones: [],
    can: { manage: false, progress: false },
    ...over,
  };
}

const pickers = { costCodes: [], contractors: [], members: [] };

function renderTab(language: 'en' | 'ar', v = view()) {
  return render(
    <LanguageProvider initial={language}>
      <ScheduleTab projectId="p1" projectName="Villa" view={v} pickers={pickers} />
    </LanguageProvider>,
  );
}

describe('ScheduleTab', () => {
  it('shows each task in the table and draws a link between them', () => {
    const { container } = renderTab('en');
    expect(screen.getAllByText('Footings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Slab').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('svg path[marker-end]')).toHaveLength(1);
    // Read-only: nothing to type into.
    expect(container.querySelector('input')).toBeNull();
  });

  it('mirrors the link arrows on an Arabic page', () => {
    const ltr = renderTab('en').container.querySelector('svg path[marker-end]')!.getAttribute('d')!;
    const rtl = renderTab('ar').container.querySelector('svg path[marker-end]')!.getAttribute('d')!;
    const firstX = (d: string) => Number(d.split(' ')[0]!.slice(1));
    const lastX = (d: string) => Number(d.split(' ').at(-2)!.replace('L', ''));
    // Left to right the arrow ends to the right of where it starts; right to left, to the left.
    expect(lastX(ltr)).toBeGreaterThan(firstX(ltr));
    expect(lastX(rtl)).toBeLessThan(firstX(rtl));
  });

  it('offers inline edits to a planner and an empty state when there is nothing yet', () => {
    const { container } = renderTab('en', view({ can: { manage: true, progress: true } }));
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0);
    renderTab('en', view({ tasks: [], dependencies: [], can: { manage: true, progress: true } }));
    expect(screen.getByText('No schedule for this site yet')).toBeInTheDocument();
  });
});
