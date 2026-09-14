import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from '@sitebook/shared';

/**
 * The only exception type the domain code throws. Carries the machine-readable
 * `code` clients branch on (spec §9), so the HTTP status never has to.
 */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: ErrorCode, message: string, details?: unknown) {
    const body: ApiErrorBody = details === undefined ? { code, message } : { code, message, details };
    super(body, status);
  }

  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED, message);
  }

  static invalidToken(message = 'Token is not valid'): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, ERROR_CODES.INVALID_TOKEN, message);
  }

  static tokenExpired(message = 'Token has expired'): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, ERROR_CODES.TOKEN_EXPIRED, message);
  }

  static forbidden(message = 'Not allowed'): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, message);
  }

  static moduleNotEnabled(moduleName: string): ApiError {
    return new ApiError(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.MODULE_NOT_ENABLED,
      `The ${moduleName} module is not enabled on this plan`,
      { module: moduleName },
    );
  }

  static projectNotAssigned(projectId: string): ApiError {
    return new ApiError(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.PROJECT_NOT_ASSIGNED,
      'You are not assigned to this project',
      { project_id: projectId },
    );
  }

  static notFound(what = 'Resource'): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, `${what} not found`);
  }

  static validationFailed(details: unknown, message = 'Request body is not valid'): ApiError {
    return new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ERROR_CODES.VALIDATION_FAILED,
      message,
      details,
    );
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, message, details);
  }

  static periodFinalised(details?: unknown): ApiError {
    return new ApiError(
      HttpStatus.CONFLICT,
      ERROR_CODES.PERIOD_FINALISED,
      'The wage period covering this date is finalised',
      details,
    );
  }

  /**
   * The term ran out and the grace period with it.
   *
   * Deliberately not `tenantSuspended`: the account works, it can still be read, and the fix is a
   * renewal rather than a phone call to support. A client that cannot tell the two apart will show
   * the wrong thing to somebody standing on a site wondering why the roll call will not save.
   */
  static planExpired(): ApiError {
    return new ApiError(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.PLAN_EXPIRED,
      'This plan has run out. The account can still be read, but nothing new can be saved until it is renewed.',
    );
  }

  static tenantSuspended(): ApiError {
    return new ApiError(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.TENANT_SUSPENDED,
      'This account is suspended',
    );
  }

  static userPending(): ApiError {
    return new ApiError(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.USER_PENDING,
      'This user has not been activated',
    );
  }

  static phoneAlreadyRegistered(): ApiError {
    return new ApiError(
      HttpStatus.CONFLICT,
      ERROR_CODES.PHONE_ALREADY_REGISTERED,
      'That phone number is already on the team',
    );
  }
}
