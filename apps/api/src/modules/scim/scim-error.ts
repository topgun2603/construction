import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { SCIM_SCHEMA_ERROR } from '@sitebook/shared';
import type { Response } from 'express';

/**
 * A SCIM error (RFC 7644 §3.12): `{ schemas, status, scimType?, detail }`, with `status` a string.
 *
 * SCIM clients parse this exact shape — Entra ID reads `scimType: "uniqueness"` on a 409 to know a
 * user already exists and should be matched instead — so the SCIM routes answer in it rather than
 * in the API's own `{ code, message }` envelope.
 */
export class ScimError extends HttpException {
  constructor(status: number, detail: string, scimType?: string) {
    super(
      {
        schemas: [SCIM_SCHEMA_ERROR],
        status: String(status),
        ...(scimType ? { scimType } : {}),
        detail,
      },
      status,
    );
  }

  static notFound(what: string): ScimError {
    return new ScimError(HttpStatus.NOT_FOUND, `${what} not found`);
  }

  static invalidValue(detail: string): ScimError {
    return new ScimError(HttpStatus.BAD_REQUEST, detail, 'invalidValue');
  }

  static uniqueness(detail: string): ScimError {
    return new ScimError(HttpStatus.CONFLICT, detail, 'uniqueness');
  }

  static invalidFilter(detail: string): ScimError {
    return new ScimError(HttpStatus.BAD_REQUEST, detail, 'invalidFilter');
  }

  static mutability(detail: string): ScimError {
    return new ScimError(HttpStatus.BAD_REQUEST, detail, 'mutability');
  }
}

/** Renders every failure on a SCIM route as a SCIM error, whatever threw it. */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ScimException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = {
      schemas: [SCIM_SCHEMA_ERROR],
      status: String(status),
      detail: 'Something went wrong',
    };

    if (exception instanceof ScimError) {
      status = exception.getStatus();
      body = exception.getResponse() as Record<string, unknown>;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      const detail =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : exception.message;
      body = { schemas: [SCIM_SCHEMA_ERROR], status: String(status), detail };
    } else {
      this.logger.error({ err: exception }, 'Unhandled SCIM error');
    }

    response.status(status).type('application/scim+json').send(JSON.stringify(body));
  }
}
