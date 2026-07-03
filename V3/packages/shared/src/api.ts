/**
 * File: api.ts
 * Purpose:
 *   Defines shared API response shapes.
 *
 * Why this file exists:
 *   Frontend, backend, and future mobile clients should all understand errors
 *   and success responses the same way.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface ApiSuccessBody<T> {
  data: T;
}
