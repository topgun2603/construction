import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SideNav } from './side-nav';

/**
 * What each role is offered in the navigation.
 *
 * Modules alone were never enough and this is the regression that proves it: a client is on a Pro
 * account, so every module check in the rail passes for them, and they may open almost none of
 * those screens. The filter has to read permissions too, or a client is given a rail full of links
 * that answer 403 — with the worst of them being Overview, which is the builder's cost of the job.
 */

const ALL_MODULES = [
  'projects',
  'dpr',
  'attendance',
  'labour',
  'indents',
  'materials',
  'notifications',
  'dashboard',
  'expenses',
  'stock',
  'reports',
  'client_portal',
  'documents',
];

const OWNER_PERMISSIONS = [
  'projects.view',
  'expenses.view',
  'workers.view',
  'attendance.view',
  'wages.view',
  'payments.view',
  'stock.view',
  'indents.approve',
  'reports.view',
  'documents.view',
];

/** Exactly what the client preset holds. */
const CLIENT_PERMISSIONS = ['projects.view', 'dpr.view', 'messages.post', 'documents.view'];

function draw(role: string, permissions: string[], modules = ALL_MODULES) {
  return render(
    <SideNav
      tenantName="ARK Constructions"
      logoUrl={null}
      plan="pro"
      role={role}
      permissions={permissions}
      enabledModules={modules}
      activeSiteCount={3}
      pendingApprovals={0}
    />,
  );
}

function links() {
  return screen
    .getAllByRole('link')
    .map((a) => a.textContent?.trim() ?? '')
    .filter(Boolean);
}

describe('the client', () => {
  it('is never shown the overview, which is cost and approvals', () => {
    draw('client', CLIENT_PERMISSIONS);
    expect(links().join(' ')).not.toMatch(/overview/i);
  });

  it('is shown only their own sites and their documents', () => {
    draw('client', CLIENT_PERMISSIONS);
    const shown = links().join(' ');
    expect(shown).toMatch(/sites/i);
    expect(shown).toMatch(/documents/i);
  });

  it('is shown nothing about labour, stock or money', () => {
    draw('client', CLIENT_PERMISSIONS);
    const shown = links().join(' ');
    for (const hidden of ['Workers', 'Attendance', 'Stock', 'Expenses', 'Approvals', 'Reports']) {
      expect(shown).not.toContain(hidden);
    }
  });
});

describe('the owner', () => {
  it('gets the overview and the labour section', () => {
    draw('owner', OWNER_PERMISSIONS);
    const shown = links().join(' ');
    expect(shown).toMatch(/overview/i);
    expect(shown).toMatch(/workers/i);
    expect(shown).toMatch(/settings/i);
  });
});

describe('modules and permissions both have to agree', () => {
  it('hides a screen the tenant has not paid for, however permitted the person is', () => {
    draw('owner', OWNER_PERMISSIONS, ['projects', 'dashboard', 'labour']);
    expect(links().join(' ')).not.toMatch(/stock/i);
  });

  it('hides a screen the person cannot open, however paid-for the module is', () => {
    // The inverse, and the one the old module-only filter got wrong.
    draw('site_supervisor', ['projects.view', 'attendance.view']);
    const shown = links().join(' ');
    expect(shown).toMatch(/sites/i);
    expect(shown).not.toMatch(/expenses/i);
    expect(shown).not.toMatch(/overview/i);
  });

  it('keeps Settings to the owner even when permissions would allow it', () => {
    draw('project_manager', [...OWNER_PERMISSIONS, 'team.manage']);
    expect(links().join(' ')).not.toMatch(/settings/i);
  });
});
