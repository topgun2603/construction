import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ipAllowed, securityIpApplies, securityMfaRequired } from '@sitebook/shared';
import type { AuthenticatedRequest } from '../../common/auth/request-user';
import { ALLOW_ANY_IP_KEY, ALLOW_WITHOUT_MFA_KEY } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { clientIpOf } from '../../common/net/client-ip';
import { SecurityAuditService } from './security-audit.service';
import { SessionService } from './session.service';

/** One audit entry per person, reason and address per this long — not one per refused request. */
const REFUSAL_LOG_INTERVAL_MS = 10 * 60_000;

/**
 * Enforces a company's sign-in rules on every authenticated request (roadmap Phase 3, item 2).
 * Runs straight after JwtAuthGuard, which has already read the rules with the tenant.
 *
 * 1. The IP allow-list, on the real client address (`clientIpOf`) — refused with IP_NOT_ALLOWED.
 * 2. Required two-factor: a session without the `mfa` claim gets MFA_REQUIRED from everything except
 *    the routes marked `@AllowWithoutMfa()` (the two-factor screen's own, sign out, switch company).
 * 3. Records the session's activity, which the idle timeout is measured on.
 *
 * A company that has never set a rule (`securityGate` null) costs nothing here but the activity
 * stamp, which is at most one small write a minute per session. Unauthenticated routes, the
 * platform console (its own audience and guard) and link-based access (worker, RFI responder) have
 * no `request.user` and are never touched.
 */
@Injectable()
export class SecurityPolicyGuard implements CanActivate {
  private readonly logged = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly audit: SecurityAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const user = request.user;
    if (!user) return true;

    const gate = request.securityGate ?? null;
    const ip = clientIpOf(request);

    if (gate) {
      const anyIp = this.flag(context, ALLOW_ANY_IP_KEY);
      if (
        !anyIp &&
        securityIpApplies(
          { mode: gate.ipMode, exemptOwners: gate.ipExemptOwners, exemptRoles: gate.ipExemptRoles },
          { role: user.role, app: user.app === true },
        ) &&
        !ipAllowed(ip, gate.ipCidrs)
      ) {
        await this.logRefusal(user.tenantId, user.userId, 'ip_not_allowed', ip);
        throw ApiError.ipNotAllowed(ip);
      }

      if (
        user.mfa !== true &&
        securityMfaRequired(gate.mfaPolicy, user) &&
        !this.flag(context, ALLOW_WITHOUT_MFA_KEY)
      ) {
        await this.logRefusal(user.tenantId, user.userId, 'mfa_required', ip);
        throw ApiError.mfaRequired();
      }
    }

    if (user.sessionId) await this.sessions.touch(user.tenantId, user.sessionId, ip);
    return true;
  }

  private flag(context: ExecutionContext, key: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]) === true
    );
  }

  private async logRefusal(tenantId: string, userId: string, reason: string, ip: string): Promise<void> {
    const key = `${tenantId}:${userId}:${reason}:${ip}`;
    const now = Date.now();
    const last = this.logged.get(key);
    if (last !== undefined && now - last < REFUSAL_LOG_INTERVAL_MS) return;
    if (this.logged.size > 10_000) this.logged.clear();
    this.logged.set(key, now);
    await this.audit.record(tenantId, {
      actorId: userId,
      action: 'security.request_refused',
      entity: 'users',
      entityId: userId,
      after: { reason, ip },
    });
  }
}
