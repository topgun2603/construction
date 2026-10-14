import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../auth/request-user';
import { clientIpOf } from '../net/client-ip';

/**
 * Who is acting, for the audit trigger (migration 20261007000200_full_audit_log).
 *
 * The audit log is written by a Postgres trigger, which sees every changed row but cannot know
 * which person changed it. `TenantDb` already sets `app.tenant_id` on every transaction; it now
 * sets the actor, request id, IP and user agent beside it, read from here.
 *
 * AsyncLocalStorage rather than threading an actor through every service signature: the point
 * of a trigger-based log is that nobody has to remember to call it, and requiring every
 * `tenantDb.transaction(...)` caller to pass the user would bring that back.
 *
 * The request object itself is stored, not the user: the middleware runs before JwtAuthGuard
 * has attached `request.user`, and reading it lazily at transaction time picks up whatever the
 * guard established. Outside a request — a queue job, a cron — there is no store, and the log
 * records the change as the system's.
 */
interface AuditStore {
  /**
   * `apiKey` is set by the public API's key guard (`/public/v1`): such a request has no user, and
   * whatever it changes is recorded as the key — see migration 20261010000500_public_api.
   */
  req: Request & AuthenticatedRequest & { apiKey?: { id: string } };
}

const storage = new AsyncLocalStorage<AuditStore>();

export interface AuditActor {
  actorId: string;
  /** `api_key` for a public API request; empty otherwise (the trigger works the type out). */
  actorType: string;
  requestId: string;
  ip: string;
  userAgent: string;
}

/** Empty strings rather than nulls, because that is what `set_config` and the trigger expect. */
const NO_ACTOR: AuditActor = { actorId: '', actorType: '', requestId: '', ip: '', userAgent: '' };

export function currentAuditActor(): AuditActor {
  const req = storage.getStore()?.req;
  if (!req) return NO_ACTOR;
  const requestId = req.headers['x-request-id'];
  return {
    actorId: req.apiKey?.id ?? req.user?.userId ?? '',
    actorType: req.apiKey ? 'api_key' : '',
    requestId: typeof requestId === 'string' ? requestId : '',
    // The same address the IP allow-list checks: `req.ip` under Express's `trust proxy` setting,
    // or the browser's address vouched for by the web server — never a raw, spoofable
    // X-Forwarded-For. See `clientIpOf`.
    ip: clientIpOf(req),
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
  };
}

/** Opens the request's audit scope. Registered after RequestIdMiddleware, so the id is set. */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    storage.run({ req }, next);
  }
}
