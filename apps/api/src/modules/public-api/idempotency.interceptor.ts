import {
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { Observable, catchError, from, of, switchMap, throwError } from 'rxjs';
import { ERROR_CODES, PUBLIC_API_IDEMPOTENCY_HOURS } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { webhookJson } from '../webhooks/webhook-events.service';
import type { PublicApiRequest } from './api-key.guard';

const HEADER = 'idempotency-key';
const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{1,255}$/;

/**
 * `Idempotency-Key` on public POSTs, the way Stripe does it.
 *
 * The first request with a key reserves it (a row with no answer yet), runs, and stores its answer.
 * A retry with the same key and the same request gets that answer back — same status, same body,
 * `Idempotent-Replayed: true` — and nothing is created twice. The same key with a *different*
 * request is refused (409), because that is a bug in the caller, not a retry; and a retry that
 * arrives while the first is still running is refused too (409, try again) rather than racing it.
 *
 * Only successful answers are kept. A request that failed — a validation error, a 500 — releases its
 * key, so the corrected retry runs for real. Keys are per API key and kept for a day.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly tenantDb: TenantDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<PublicApiRequest & { rawBody?: Buffer }>();
    const response = context.switchToHttp().getResponse<Response>();
    const header = request.headers[HEADER];
    const principal = request.apiKey;
    if (request.method !== 'POST' || typeof header !== 'string' || !principal) return next.handle();

    if (!KEY_PATTERN.test(header)) {
      throw ApiError.validationFailed(
        { 'Idempotency-Key': 'invalid' },
        'Idempotency-Key must be 1–255 letters, digits or - _ : .',
      );
    }
    const tenantId = principal.tenantId;
    // Nest applies the route's status after the interceptors finish, so it is read from the route
    // itself: `@HttpCode`, or 201 — Nest's default for a POST.
    const successStatus =
      (Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as number | undefined) ?? HttpStatus.CREATED;
    const requestHash = createHash('sha256')
      .update(`${request.method} ${request.originalUrl.split('?')[0]}\n`)
      .update(request.rawBody ?? Buffer.alloc(0))
      .digest('hex');

    return from(this.reserve(tenantId, principal.id, header, requestHash)).pipe(
      switchMap((reservation) => {
        if (reservation.kind === 'replay') {
          response.status(reservation.status);
          response.setHeader('Idempotent-Replayed', 'true');
          return of(reservation.body);
        }
        return next.handle().pipe(
          switchMap((body) =>
            from(this.complete(tenantId, reservation.id, successStatus, body)).pipe(
              switchMap(() => of(body)),
            ),
          ),
          catchError((error: unknown) =>
            from(this.release(tenantId, reservation.id)).pipe(switchMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  private async reserve(
    tenantId: string,
    apiKeyId: string,
    key: string,
    requestHash: string,
  ): Promise<{ kind: 'run'; id: string } | { kind: 'replay'; status: number; body: unknown }> {
    const staleBefore = new Date(Date.now() - PUBLIC_API_IDEMPOTENCY_HOURS * 3600 * 1000);
    try {
      const row = await this.tenantDb.transaction(tenantId, async (tx) => {
        // A key older than the window is forgotten, and may be used again.
        await tx.apiIdempotencyKey.deleteMany({ where: { apiKeyId, key, createdAt: { lt: staleBefore } } });
        return tx.apiIdempotencyKey.create({ data: { tenantId, apiKeyId, key, requestHash }, select: { id: true } });
      });
      return { kind: 'run', id: row.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }

    const existing = await this.tenantDb
      .clientFor(tenantId)
      .apiIdempotencyKey.findFirst({ where: { apiKeyId, key }, select: { requestHash: true, responseStatus: true, responseBody: true } });
    if (!existing) {
      // Released between our insert and this read: the first attempt failed. Ask for a retry.
      throw idempotencyConflict('in_progress', 'A request with this Idempotency-Key just finished. Retry it.');
    }
    if (existing.requestHash !== requestHash) {
      throw idempotencyConflict(
        'key_reused',
        'This Idempotency-Key was already used for a different request. Use a new key for a new request.',
      );
    }
    if (existing.responseStatus === null) {
      throw idempotencyConflict('in_progress', 'A request with this Idempotency-Key is still being processed. Retry shortly.');
    }
    return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
  }

  private async complete(tenantId: string, id: string, status: number, body: unknown): Promise<void> {
    await this.tenantDb.clientFor(tenantId).apiIdempotencyKey.update({
      where: { id },
      data: { responseStatus: status, responseBody: body === undefined ? Prisma.JsonNull : webhookJson(body) },
    });
  }

  private async release(tenantId: string, id: string): Promise<void> {
    await this.tenantDb.clientFor(tenantId).apiIdempotencyKey.deleteMany({ where: { id } });
  }
}

function idempotencyConflict(reason: 'key_reused' | 'in_progress', message: string): ApiError {
  return new ApiError(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, message, { idempotency: reason });
}
