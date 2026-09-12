import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  permissionsForSystemRole,
  systemRoleSeesAllProjects,
  type Permission,
} from './permissions';
import { USER_ROLES } from './enums';

/**
 * The presets are a description of what the product already allowed, not an opinion about
 * what each role should do. These tests are the guard on that: widening a role is a
 * security change and must never happen as a side effect of editing a list.
 */
describe('permission catalogue', () => {
  it('has no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('shows every permission in the role editor', () => {
    // A permission missing from the groups is one an owner can never grant â€” it would be
    // enforced by the API and invisible in the UI.
    const shown = new Set(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.permission)));
    for (const permission of PERMISSIONS) {
      expect(shown.has(permission)).toBe(true);
    }
    expect(shown.size).toBe(PERMISSIONS.length);
  });

  it('gives the owner everything', () => {
    // An owner locked out of part of their own account has nobody to ask for help.
    expect([...permissionsForSystemRole('owner')].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('grants only real permissions to every role', () => {
    for (const role of USER_ROLES) {
      for (const permission of permissionsForSystemRole(role)) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('matches the access each role is meant to have', () => {
    /*
     * Started as a transcription of the `@Roles` decorators at the time of conversion, and is
     * now the record of every deliberate decision since â€” the stock permissions below were new
     * capabilities, not a conversion of anything.
     *
     * The point is unchanged: a role gaining access has to be a decision somebody made here,
     * never a side effect of editing a list somewhere else.
     */
    const expected: Record<string, Permission[]> = {
      project_manager: [
        'attendance.record',
        'attendance.view',
        'contractors.manage',
        'dpr.file',
        'dpr.view',
        'expenses.approve',
        'expenses.record',
        'expenses.view',
        'indents.approve',
        'indents.raise',
        'estimates.manage',
        'materials.manage',
        'messages.internal',
        'messages.post',
        'milestones.manage',
        'documents.manage',
        'documents.view',
        'client_payments.view',
        'approvals.request',
        'payments.record',
        'payments.view',
        'projects.manage',
        'projects.view',
        'reports.view',
        'stock.record',
        'stock.view',
        'wages.view',
        'workers.delete',
        'workers.manage',
        'workers.view',
      ],
      site_supervisor: [
        'attendance.record',
        'attendance.view',
        'dpr.file',
        'dpr.view',
        'expenses.record',
        'expenses.view',
        'indents.raise',
        'messages.internal',
        'messages.post',
        'documents.view',
        'approvals.request',
        'payments.record',
        'projects.view',
        'stock.record',
        'stock.view',
        'workers.view',
      ],
      accounts: [
        'attendance.view',
        'contractors.manage',
        'dpr.view',
        'expenses.approve',
        'expenses.record',
        'expenses.view',
        'messages.internal',
        'messages.post',
        'documents.view',
        'client_payments.view',
        'client_payments.manage',
        'payments.reconcile',
        'payments.record',
        'payments.view',
        'projects.view',
        'reports.people',
        'reports.view',
        'stock.view',
        'wages.finalise',
        'wages.generate',
        'wages.pay',
        'wages.view',
        'workers.manage',
        'workers.view',
      ],
      client: [
        'documents.view',
        'dpr.view',
        'messages.post',
        'projects.view',
        'client_payments.view',
        'approvals.decide',
      ],
    };

    for (const [role, permissions] of Object.entries(expected)) {
      expect([...permissionsForSystemRole(role as never)].sort()).toEqual(permissions.sort());
    }
  });

  it('reserves the dangerous permissions for the owner', () => {
    // Anything that can change who else has access, or take the account apart.
    const ownerOnly: Permission[] = [
      'team.manage',
      'roles.manage',
      'tenant.manage',
      'projects.delete',
      'contractors.delete',
    ];
    for (const role of USER_ROLES) {
      if (role === 'owner') continue;
      for (const permission of ownerOnly) {
        expect(permissionsForSystemRole(role)).not.toContain(permission);
      }
    }
  });

  it('scopes everyone but owner and accounts to their own sites', () => {
    expect(systemRoleSeesAllProjects('owner')).toBe(true);
    expect(systemRoleSeesAllProjects('accounts')).toBe(true);
    expect(systemRoleSeesAllProjects('project_manager')).toBe(false);
    expect(systemRoleSeesAllProjects('site_supervisor')).toBe(false);
    expect(systemRoleSeesAllProjects('client')).toBe(false);
  });
});
