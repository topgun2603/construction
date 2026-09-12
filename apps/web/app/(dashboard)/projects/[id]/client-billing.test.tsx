import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Approval, ClientPayment, PaymentSchedule, PaymentStage } from '@/lib/api-types';

vi.mock('@/lib/actions', () => ({
  createPaymentStage: vi.fn(),
  updatePaymentStage: vi.fn(),
  deletePaymentStage: vi.fn(),
  recordClientPayment: vi.fn(),
  deleteClientPayment: vi.fn(),
  createApproval: vi.fn(),
  decideApproval: vi.fn(),
  deleteApproval: vi.fn(),
}));

import { PaymentScheduleTab } from './payment-schedule';
import { SiteApprovals } from './site-approvals';

function stage(over: Partial<PaymentStage> = {}): PaymentStage {
  return {
    id: 's1',
    project_id: 'p1',
    label: 'On signing',
    amount: '1000000000',
    paid: '0',
    outstanding: '1000000000',
    due_date: null,
    sort_order: 0,
    raised_at: null,
    milestone: null,
    status: 'upcoming',
    created_at: new Date().toISOString(),
    ...over,
  };
}

function schedule(over: Partial<PaymentSchedule['totals']> = {}, items: PaymentStage[] = [stage()]) {
  return {
    items,
    project_name: 'Lakeview Tower',
    totals: {
      scheduled: '1000000000',
      received: '0',
      outstanding: '1000000000',
      unallocated: '0',
      budget: null,
      ...over,
    },
  } satisfies PaymentSchedule;
}

function approval(over: Partial<Approval> = {}): Approval {
  return {
    id: 'a1',
    project_id: 'p1',
    project_name: 'Lakeview Tower',
    title: 'Bathroom tile — the darker one?',
    body: '',
    status: 'pending',
    requested_by: { id: 'u1', name: 'Ramesh Iyer', role: 'site_supervisor' },
    created_at: new Date().toISOString(),
    decided_by: null,
    decided_at: null,
    decision_note: null,
    document: null,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('the payment schedule a client sees', () => {
  it('shows the totals but offers no way to change them', () => {
    render(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule()}
        receipts={[]}
        milestones={[]}
        canManage={false}
      />,
    );
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    // A client reads this. Recording their own payments would be marking their own homework.
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add instalment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /raise/i })).not.toBeInTheDocument();
  });

  it('gives somebody who manages billing the controls', () => {
    render(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule()}
        receipts={[]}
        milestones={[]}
        canManage
      />,
    );
    expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add instalment/i })).toBeInTheDocument();
  });

  it('renders crore figures without going through Number', () => {
    // ₹5,00,00,000 is 5e10 paise. The moment any of this goes through a double it stops being
    // exact, and this is the screen where a rounding error is somebody's money.
    render(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule({ scheduled: '5000000000', outstanding: '5000000000' })}
        receipts={[]}
        milestones={[]}
        canManage={false}
      />,
    );
    expect(screen.getAllByText('₹5,00,00,000.00').length).toBeGreaterThan(0);
  });

  it('tells the builder when the schedule does not add up to the contract', () => {
    render(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule({ scheduled: '1000000000', budget: '5000000000' })}
        receipts={[]}
        milestones={[]}
        canManage
      />,
    );
    expect(screen.getByText(/is not on it yet/i)).toBeInTheDocument();
  });

  it('does not nag the client about the builder s own contract arithmetic', () => {
    render(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule({ scheduled: '1000000000', budget: '5000000000' })}
        receipts={[]}
        milestones={[]}
        canManage={false}
      />,
    );
    expect(screen.queryByText(/is not on it yet/i)).not.toBeInTheDocument();
  });

  it('offers Raise only on an instalment nobody has asked for yet', () => {
    const { rerender } = render(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule({}, [stage({ raised_at: null })])}
        receipts={[]}
        milestones={[]}
        canManage
      />,
    );
    expect(screen.getByRole('button', { name: /raise/i })).toBeInTheDocument();

    rerender(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule({}, [stage({ raised_at: new Date().toISOString(), status: 'due' })])}
        receipts={[]}
        milestones={[]}
        canManage
      />,
    );
    expect(screen.queryByRole('button', { name: /raise/i })).not.toBeInTheDocument();
  });

  it('names a receipt that belongs to no instalment rather than hiding it', () => {
    const receipt: ClientPayment = {
      id: 'r1',
      project_id: 'p1',
      stage_id: null,
      stage_label: null,
      amount: '250000000',
      received_on: '2026-03-10',
      mode: 'bank',
      reference: 'UTR123',
      note: null,
      recorded_by: { id: 'u1', name: 'Anita Desai' },
      created_at: new Date().toISOString(),
    };
    render(
      <PaymentScheduleTab
        projectId="p1"
        schedule={schedule({ unallocated: '250000000' })}
        receipts={[receipt]}
        milestones={[]}
        canManage
      />,
    );
    /*
     * Twice, and both are wanted: the banner explains that some money is sitting unallocated
     * against the total, and the row below names the receipt it came from. Neither is much use
     * without the other.
     */
    expect(screen.getAllByText(/against no particular instalment/i)).toHaveLength(2);
  });
});

describe('approvals', () => {
  it('lets whoever may decide answer, and nobody else', () => {
    const { rerender } = render(
      <SiteApprovals
        projectId="p1"
        approvals={[approval()]}
        sharedDocuments={[]}
        canRequest={false}
        canDecide
      />,
    );
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();

    rerender(
      <SiteApprovals
        projectId="p1"
        approvals={[approval()]}
        sharedDocuments={[]}
        canRequest
        canDecide={false}
      />,
    );
    // A supervisor may ask. Answering their own question is the thing the split prevents.
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it('names the decider and their role, so a stand-in decision never reads as the client s', () => {
    render(
      <SiteApprovals
        projectId="p1"
        approvals={[
          approval({
            status: 'approved',
            decided_by: { id: 'u9', name: 'Gowtham Kumar', role: 'owner' },
            decided_at: new Date().toISOString(),
            decision_note: 'Confirmed on the phone.',
          }),
        ]}
        sharedDocuments={[]}
        canRequest
        canDecide
      />,
    );
    expect(screen.getByText(/approved by gowtham kumar \(owner\)/i)).toBeInTheDocument();
    expect(screen.getByText('Confirmed on the phone.')).toBeInTheDocument();
  });

  it('offers nothing to change a decision once it is made', () => {
    render(
      <SiteApprovals
        projectId="p1"
        approvals={[
          approval({
            status: 'approved',
            decided_by: { id: 'u1', name: 'Vikram Shah', role: 'client' },
            decided_at: new Date().toISOString(),
          }),
        ]}
        sharedDocuments={[]}
        canRequest
        canDecide
      />,
    );
    // An approval somebody can quietly revise is evidence of nothing.
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
  });

  it('separates what is waiting from what is settled', () => {
    render(
      <SiteApprovals
        projectId="p1"
        approvals={[
          approval({ id: 'a1' }),
          approval({
            id: 'a2',
            status: 'rejected',
            decided_by: { id: 'u1', name: 'Vikram Shah', role: 'client' },
            decided_at: new Date().toISOString(),
          }),
        ]}
        sharedDocuments={[]}
        canRequest
        canDecide
      />,
    );
    expect(screen.getByText(/waiting on an answer/i)).toBeInTheDocument();
    expect(screen.getByText(/^decided$/i)).toBeInTheDocument();
  });
});
