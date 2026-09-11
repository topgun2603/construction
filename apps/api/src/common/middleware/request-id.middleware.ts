import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Gives every request an id and echoes it back, so a log line, a Sentry event and
 * a user's screenshot can be tied together (spec §15). An inbound id is trusted
 * only as a correlation hint — it never reaches a query.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header('x-request-id');
    const requestId = inbound && isSafeRequestId(inbound) ? inbound : randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}

function isSafeRequestId(value: string): boolean {
  return value.length <= 64 && /^[A-Za-z0-9_.:-]+$/.test(value);
}
