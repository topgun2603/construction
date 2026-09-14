import { permissionsForSystemRole } from '@sitebook/shared';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { ModuleName } from '@sitebook/shared';
import type { RequestUser } from '../auth/request-user';
import { PlanGuard } from './plan.guard';

function contextWith(user: RequestUser | undefined): ExecutionContext {
  const request = { user };
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function userWith(modules: string[]): RequestUser {
  return {
    userId: 'u1',
    tenantId: 't1',
    role: 'owner',
    roleName: 'Owner',
    permissions: permissionsForSystemRole('owner'),
    projectIds: [],
    seesAllProjects: true,
    plan: 'three_months',
    enabledModules: modules,
  };
}

function guardRequiring(moduleName: ModuleName | undefined): PlanGuard {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(moduleName);
  return new PlanGuard(reflector);
}

describe('PlanGuard', () => {
  it('allows a route with no module requirement', () => {
    expect(guardRequiring(undefined).canActivate(contextWith(userWith([])))).toBe(true);
  });

  it('allows a route whose module is enabled', () => {
    const guard = guardRequiring('attendance');
    expect(guard.canActivate(contextWith(userWith(['projects', 'attendance'])))).toBe(true);
  });

  it('rejects a route whose module is not on the plan', () => {
    const guard = guardRequiring('expenses');
    expect(() => guard.canActivate(contextWith(userWith(['projects', 'attendance'])))).toThrow(
      /expenses module is not enabled/,
    );
  });

  it('reports MODULE_NOT_ENABLED so the client can offer an upgrade', () => {
    const guard = guardRequiring('reports');
    try {
      guard.canActivate(contextWith(userWith([])));
      throw new Error('expected the guard to reject');
    } catch (error) {
      const body = (error as { getResponse: () => { code: string; details: unknown } }).getResponse();
      expect(body.code).toBe('MODULE_NOT_ENABLED');
      expect(body.details).toEqual({ module: 'reports' });
      expect((error as { getStatus: () => number }).getStatus()).toBe(403);
    }
  });

  it('fails closed when the request carries no authenticated user', () => {
    // Reaching a module-gated route unauthenticated means JwtAuthGuard was skipped.
    // Treating that as "allowed" would turn a wiring mistake into an open endpoint.
    const guard = guardRequiring('labour');
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(/Authentication required/);
  });
});
