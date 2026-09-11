import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type ApiErrorBody } from '@sitebook/shared';
import type { Request, Response } from 'express';

/**
 * Turns everything that escapes a handler into the `{ code, message, details? }`
 * envelope clients expect (spec §9). Unknown failures are logged with the request
 * id and reported as INTERNAL — the message is never forwarded, because stack
 * traces and driver errors leak schema details.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.header('x-request-id');

    const { status, body } = this.translate(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { requestId, method: request.method, url: request.originalUrl, err: exception },
        'Unhandled error',
      );
    }

    response.status(status).json(body);
  }

  private translate(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (isApiErrorBody(payload)) return { status: exception.getStatus(), body: payload };
      return {
        status: exception.getStatus(),
        body: {
          code: codeForStatus(exception.getStatus()),
          message: typeof payload === 'string' ? payload : exception.message,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.translatePrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong' },
    };
  }

  private translatePrisma(
    error: Prisma.PrismaClientKnownRequestError,
  ): { status: number; body: ApiErrorBody } {
    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: ERROR_CODES.CONFLICT,
            message: 'That record already exists',
            details: { constraint: error.meta?.['target'] ?? null },
          },
        };
      case 'P2003':
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          body: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'A referenced record does not exist',
          },
        };
      case 'P2025':
        // RLS makes another tenant's row indistinguishable from a missing one, which
        // is the behaviour we want: no existence oracle across tenants.
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: ERROR_CODES.NOT_FOUND, message: 'Resource not found' },
        };
      default:
        this.logger.error({ prismaCode: error.code, meta: error.meta }, 'Prisma error');
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong' },
        };
    }
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    'message' in value
  );
}

function codeForStatus(status: number): ApiErrorBody['code'] {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT;
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ERROR_CODES.VALIDATION_FAILED;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return ERROR_CODES.INTERNAL;
  }
}
