import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Approval } from '@/lib/api-types';
import type { ClientChangeOrder } from '@/lib/change-order-types';
import { ChangeOrderApprovalDetails, ClientChangeOrders } from './client-change-order';
import { changeOrderDaysText } from './labels';

const changeOrder: ClientChangeOrder = {
  id: 'co1',
  label: 'CO-001 rev 1',
  title: 'Extra partition wall',
  description: 'Study split into two rooms.',
  reason: 'client_request',
  status: 'sent',
  client_price: '650000',
  tax: '0',
  client_total: '650000',
  time_impact_days: 7,
  items: [{ description: 'Brick partition 115mm', quantity: '10', unit: 'm2' }],
};

function approval(over: Partial<Approval> = {}): Approval {
  return {
    id: 'a1',
    project_id: 'p1',
    project_name: 'Lake View',
    title: 'Change order CO-001 rev 1: Extra partition wall',
    body: 'Price: ₹6,500.00',
    status: 'pending',
    requested_by: { id: 'u1', name: 'Owner', role: 'owner' },
    created_at: new Date().toISOString(),
    decided_by: null,
    decided_at: null,
    decision_note: null,
    document: null,
    change_order: changeOrder,
    ...over,
  };
}

describe('a change order as the client sees it', () => {
  it('shows the work, the price and the days', () => {
    render(<ChangeOrderApprovalDetails changeOrder={changeOrder} />);
    expect(screen.getByText('Brick partition 115mm')).toBeTruthy();
    // Price and total, both 6,500 with no tax — and nothing that could be the cost.
    expect(screen.getAllByText(/6,500\.00/)).toHaveLength(2);
    expect(screen.getByText('+7 days')).toBeTruthy();
  });

  it('lists the ones waiting on them apart from those already decided', () => {
    render(
      <ClientChangeOrders
        projectId="p1"
        approvals={[
          approval(),
          approval({ id: 'a2', status: 'approved', change_order: { ...changeOrder, id: 'co2', title: 'Rock excavation' } }),
          // A plain approval is not a change order and stays in the approvals tab only.
          approval({ id: 'a3', change_order: null, title: 'Tile sample' }),
        ]}
      />,
    );
    expect(screen.getByText('Waiting for your decision')).toBeTruthy();
    expect(screen.getByText('Decided')).toBeTruthy();
    expect(screen.getByText('Rock excavation')).toBeTruthy();
    expect(screen.queryByText('Tile sample')).toBeNull();
    expect(screen.getByRole('link', { name: 'Approve or reject' }).getAttribute('href')).toBe('/projects/p1?tab=approvals');
  });
});

describe('days on a change order', () => {
  const t = (text: string) => text;
  it('reads as a change to the handover date', () => {
    expect(changeOrderDaysText(0, t)).toBe('No change');
    expect(changeOrderDaysText(1, t)).toBe('+1 day');
    expect(changeOrderDaysText(-3, t)).toBe('−3 days');
  });
});
