import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';

/**
 * OWNER ONLY, for everything in this module: the routes ask for `tenant.manage`, but that can be
 * handed to a custom role, and taking every row out of the company, deleting it, or rewriting a
 * person's name are decisions for whoever owns it — the same rule as the Security page and the AI
 * controls beside it.
 */
export function assertOwner(actor: RequestUser, doing: string): void {
  if (actor.role !== 'owner') {
    throw ApiError.forbidden(`Only an owner can ${doing}.`);
  }
}
