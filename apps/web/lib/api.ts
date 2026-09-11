import type { ApiErrorBody } from '@sitebook/shared';

const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/v1';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiRequestError';
  }

  get code(): string {
    return this.body.code;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  accessToken?: string;
}

/**
 * Single entry point to the API. Every response is either parsed JSON or an
 * `ApiRequestError` carrying the `{ code, message }` envelope (spec §9), so callers
 * branch on `error.code` rather than on status numbers or message text.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, accessToken, headers, ...rest } = options;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // Dashboard data is per-user; caching it at the edge would serve one builder's
    // numbers to another.
    cache: 'no-store',
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      isApiErrorBody(payload)
        ? payload
        : { code: 'INTERNAL', message: `Request failed with ${response.status}` },
    );
  }

  return payload as T;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

export { API_URL };
